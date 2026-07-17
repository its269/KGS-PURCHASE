import { NextResponse } from "next/server";
import { getSessionFromRequest, getActiveCompanyFromRequest } from "@/lib/session-store";
import { isExcludedBranchAlias, resolveCompanyIdForBranch } from "@/lib/companies";
import { MySqlService } from "@/services/mysql";
import {
    computeReplenishmentForBranch,
    rebuildAllReplenishmentCache,
    TARGET_DAYS_OF_COVER,
} from "@/lib/replenishment-engine";
import { buildBranchBrief } from "@/lib/replenishment-insights";
import { invalidateCache } from "@/lib/server-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rebuildInFlight = new Map();

function isCacheFresh(cacheUpdatedAt, dataWatermark) {
    if (!cacheUpdatedAt) return false;
    const cacheTs = new Date(cacheUpdatedAt).getTime();
    if (!Number.isFinite(cacheTs)) return false;

    if (dataWatermark) {
        const wmTs = new Date(dataWatermark).getTime();
        if (Number.isFinite(wmTs) && cacheTs < wmTs) return false;
    }

    return true;
}

function briefFromStats(stats, branch) {
    const isMain = String(branch).trim().toUpperCase() === "MAIN";
    if (!stats?.itemCount) {
        return {
            title: "All good — nothing to order",
            body: "",
            action: isMain
                ? "MAIN can cover all branch replenishment needs right now."
                : "No transfers from MAIN needed right now.",
        };
    }
    if (stats.urgent > 0) {
        return {
            title: `${stats.urgent} urgent item(s) at ${branch}`,
            body: "",
            action: isMain
                ? `Order the urgent items first (${Math.round(stats.totalSuggested).toLocaleString()} units needed for branch replenishment).`
                : `Transfer urgent items from MAIN first (${Math.round(stats.totalSuggested).toLocaleString()} units total suggested).`,
        };
    }
    return {
        title: `${stats.itemCount} item(s) to restock at ${branch}`,
        body: "",
        action: isMain
            ? "Review Order soon items and plan vendor POs."
            : "Review Order soon items and plan transfers from MAIN.",
    };
}

function scheduleBackgroundRebuild(branch, companyId, effectiveCompanyId) {
    const key = `${effectiveCompanyId}:${branch}`;
    if (rebuildInFlight.has(key)) return;
    const job = computeReplenishmentForBranch(branch, companyId)
        .then(async (computed) => {
            await MySqlService.upsertReplenishmentCache(effectiveCompanyId, branch, computed.recommendations);
            invalidateCache(`replenishment:api:${effectiveCompanyId}:${branch}`);
            invalidateCache(`replenishment:full:${effectiveCompanyId}:${branch}`);
            invalidateCache(`replenishment:page:${effectiveCompanyId}:${branch}`);
        })
        .catch((err) => console.error("[Replenishment stale rebuild]", err))
        .finally(() => rebuildInFlight.delete(key));
    rebuildInFlight.set(key, job);
}

/** Replenishment API — cache-first, paginated, memory-cached for ultra-fast loads. */
export async function GET(request) {
    const cookie = getSessionFromRequest(request);
    if (!cookie) {
        return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const branch = searchParams.get("branch") || "MAIN";
    const companyId = getActiveCompanyFromRequest(request) || "main";
    const effectiveCompanyId = resolveCompanyIdForBranch(companyId, branch);
    const forceRefresh = searchParams.get("refresh") === "1";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const pageSizeRaw = parseInt(searchParams.get("pageSize") || "10", 10);
    // pageSize=0 means "all rows" (background full load)
    const pageSize = pageSizeRaw === 0 ? 0 : Math.max(1, Math.min(pageSizeRaw || 10, 5000));

    if (isExcludedBranchAlias(branch)) {
        return NextResponse.json({
            recommendations: [],
            brief: { headline: "Branch not available", detail: "This location is excluded from replenishment planning." },
            meta: { branch, targetDaysOfCover: TARGET_DAYS_OF_COVER, excluded: true },
        });
    }

    try {
        // Fast path: serve from MySQL cache (paginated, slim) without blocking on compute
        if (!forceRefresh) {
            const cachedPage = pageSize === 0
                ? await MySqlService.getReplenishmentFromCache(effectiveCompanyId, branch)
                : await MySqlService.getReplenishmentFromCachePage(effectiveCompanyId, branch, {
                    page,
                    pageSize,
                    slim: true,
                });

            if (cachedPage?.recommendations) {
                // Watermark check in parallel / non-blocking for stale rebuild
                MySqlService.getReplenishmentDataWatermark()
                    .then((wm) => {
                        if (!isCacheFresh(cachedPage.meta?.generatedAt, wm)) {
                            scheduleBackgroundRebuild(branch, companyId, effectiveCompanyId);
                        }
                    })
                    .catch(() => {});

                const stats = cachedPage.meta?.stats || {
                    urgent: cachedPage.recommendations.filter((r) => r.priorityLevel === "High").length,
                    soon: cachedPage.recommendations.filter((r) => r.priorityLevel === "Medium").length,
                    totalSuggested: cachedPage.recommendations.reduce((s, r) => s + (r.suggestedQty || 0), 0),
                    itemCount: cachedPage.meta?.itemCount ?? cachedPage.recommendations.length,
                };

                return NextResponse.json({
                    recommendations: cachedPage.recommendations,
                    brief: briefFromStats(
                        { ...stats, itemCount: cachedPage.meta?.itemCount ?? stats.itemCount },
                        branch
                    ),
                    meta: {
                        ...cachedPage.meta,
                        targetDaysOfCover: TARGET_DAYS_OF_COVER,
                        stockSource: "mysql",
                        salesSource: "mysql",
                        isMainWarehouseView: String(branch).trim().toUpperCase() === "MAIN",
                        servedFrom: "cache",
                    },
                });
            }
        }

        // Cold path / forced refresh: compute once, cache, return requested page
        const computed = await computeReplenishmentForBranch(branch, companyId);
        await MySqlService.upsertReplenishmentCache(effectiveCompanyId, branch, computed.recommendations);

        const all = computed.recommendations;
        const totalItems = all.length;
        let pageRecs = all;
        let pagination = {
            page: 1,
            pageSize: totalItems,
            totalItems,
            totalPages: 1,
        };

        if (pageSize > 0) {
            const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
            const safePage = Math.min(page, totalPages);
            const start = (safePage - 1) * pageSize;
            pageRecs = all.slice(start, start + pageSize);
            pagination = { page: safePage, pageSize, totalItems, totalPages };
        }

        return NextResponse.json({
            recommendations: pageRecs,
            brief: computed.brief || buildBranchBrief(all, branch),
            meta: {
                ...computed.meta,
                targetDaysOfCover: TARGET_DAYS_OF_COVER,
                pagination,
                servedFrom: forceRefresh ? "live-refresh" : "live",
                isMainWarehouseView: String(branch).trim().toUpperCase() === "MAIN",
                stats: {
                    urgent: all.filter((r) => r.priorityLevel === "High").length,
                    soon: all.filter((r) => r.priorityLevel === "Medium").length,
                    totalSuggested: all.reduce((s, r) => s + (r.suggestedQty || 0), 0),
                    itemCount: totalItems,
                },
            },
        });
    } catch (err) {
        console.error("[Replenishment API Error]", err);
        return NextResponse.json({ message: err.message }, { status: 500 });
    }
}

/** Rebuild replenishment cache for all branches (called from sync or manual refresh-all). */
export async function POST(request) {
    const cookie = getSessionFromRequest(request);
    if (!cookie) {
        return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const companyId = getActiveCompanyFromRequest(request) || "main";

    try {
        const result = await rebuildAllReplenishmentCache(companyId);
        invalidateCache("replenishment:");
        return NextResponse.json({
            ok: true,
            ...result,
            message: `Replenishment cache rebuilt for ${result.branches} branch view(s).`,
        });
    } catch (err) {
        console.error("[Replenishment Rebuild Error]", err);
        return NextResponse.json({ message: err.message }, { status: 500 });
    }
}
