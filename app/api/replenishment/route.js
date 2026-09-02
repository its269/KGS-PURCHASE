import { NextResponse } from "next/server";
import { getSessionFromRequest, getActiveCompanyFromRequest } from "@/lib/session-store";
import {
    constrainBranchParam,
    getRequestBranchAccess,
    hasNoBranchAccess,
} from "@/lib/branch-access";
import { isExcludedBranchAlias, resolveCompanyIdForBranch, getStockWarehouseIdsForBranch } from "@/lib/companies";
import { MySqlService } from "@/services/mysql";
import {
    computeReplenishmentForBranch,
    rebuildAllReplenishmentCache,
    applyLiveComingPo,
    TARGET_DAYS_OF_COVER,
    REPLENISHMENT_SALES_LOGIC_VERSION,
} from "@/lib/replenishment-engine";
import { buildBranchBrief } from "@/lib/replenishment-insights";
import { getCached, invalidateCache } from "@/lib/server-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rebuildInFlight = new Map();
const MEM_CACHE_MS = 120_000;

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
    const branchKey = String(branch).trim().toUpperCase();
    const job = computeReplenishmentForBranch(branch, companyId)
        .then(async (computed) => {
            await MySqlService.upsertReplenishmentCache(effectiveCompanyId, branch, computed.recommendations);
            invalidateCache(`replenishment:api:${effectiveCompanyId}:${branchKey}`);
            invalidateCache(`replenishment:full:${effectiveCompanyId}:${branch}`);
            invalidateCache(`replenishment:page:${effectiveCompanyId}:${branch}`);
        })
        .catch((err) => console.error("[Replenishment stale rebuild]", err))
        .finally(() => rebuildInFlight.delete(key));
    rebuildInFlight.set(key, job);
}

function scheduleBackgroundRebuildAll(companyId) {
    const key = `${companyId}:__ALL__`;
    if (rebuildInFlight.has(key)) return;
    const job = rebuildAllReplenishmentCache(companyId)
        .then(() => {
            invalidateCache("replenishment:");
            invalidateCache("accurateRetailDemand:");
            invalidateCache("liveBranchDemand:");
        })
        .catch((err) => console.error("[Replenishment full rebuild]", err))
        .finally(() => rebuildInFlight.delete(key));
    rebuildInFlight.set(key, job);
}

/**
 * Cache-first page load. Normal reads skip the heavy live overlay (15s+ demand rollup).
 * Explicit Refresh uses a fast per-row overlay (scoped stock + PO queries only).
 */
async function loadCachedPage(effectiveCompanyId, branch, {
    page,
    pageSize,
    search = "",
    priority = "",
    itemClass = "",
    bypassMemCache = false,
    liveOverlay = false,
}) {
    const branchKey = String(branch).trim().toUpperCase();
    const searchKey = String(search || "").trim().toLowerCase().slice(0, 80);
    const priorityKey = String(priority || "").trim().toLowerCase().slice(0, 20);
    const classKey = String(itemClass || "").trim().toLowerCase().slice(0, 80);
    const overlayKey = liveOverlay ? "live" : "cache";
    const memKey = `replenishment:api:${effectiveCompanyId}:${branchKey}:${page}:${pageSize}:${searchKey}:${priorityKey}:${classKey}:${overlayKey}`;

    if (bypassMemCache) {
        invalidateCache(`replenishment:api:${effectiveCompanyId}:${branchKey}`);
    }

    const filters = { search: searchKey, priority: priorityKey, itemClass: classKey };

    const loader = async () => {
        if (pageSize === 0) {
            const cached = await MySqlService.getReplenishmentFromCache(effectiveCompanyId, branch, filters);
            if (!cached?.recommendations) return null;
            let recommendations = cached.recommendations;
            if (liveOverlay && recommendations.length) {
                recommendations = await applyLiveComingPo(recommendations, branch, { slim: true, fast: true });
            }
            return { recommendations, meta: cached.meta };
        }

        const cachedPage = await MySqlService.getReplenishmentFromCachePage(effectiveCompanyId, branch, {
            page,
            pageSize,
            slim: true,
            ...filters,
        });
        if (!cachedPage) return null;
        if (!cachedPage.recommendations?.length && !cachedPage.meta?.itemCount) return null;

        let recommendations = cachedPage.recommendations || [];
        if (liveOverlay && recommendations.length) {
            recommendations = await applyLiveComingPo(recommendations, branch, { slim: true, fast: true });
        }
        return { recommendations, meta: cachedPage.meta };
    };

    return getCached(memKey, bypassMemCache ? 0 : MEM_CACHE_MS, loader);
}

/** Replenishment API — cache-first, paginated, memory-cached for ultra-fast loads. */
export async function GET(request) {
    const cookie = getSessionFromRequest(request);
    if (!cookie) {
        return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const access = await getRequestBranchAccess(request);
    if (hasNoBranchAccess(access)) {
        return NextResponse.json({
            recommendations: [],
            brief: { headline: "No branch access", detail: "Ask an admin to assign branches to this account." },
            meta: { branch: "", restricted: true },
        });
    }
    const branch = constrainBranchParam(access, searchParams.get("branch") || "MAIN") || (access.allBranches ? "MAIN" : "");
    const companyId = getActiveCompanyFromRequest(request) || "main";
    const effectiveCompanyId = resolveCompanyIdForBranch(companyId, branch);
    const forceRefresh = searchParams.get("refresh") === "1";
    const search = (searchParams.get("search") || "").trim();
    const priority = (searchParams.get("priority") || "").trim().toLowerCase();
    const itemClass = (searchParams.get("itemClass") || "").trim();
    const bypassMemCache = forceRefresh;
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const pageSizeRaw = parseInt(searchParams.get("pageSize") || "10", 10);
    const pageSize = pageSizeRaw === 0 ? 0 : Math.max(1, Math.min(pageSizeRaw || 10, 5000));
    const branchKey = String(branch).trim().toUpperCase();

    if (isExcludedBranchAlias(branch)) {
        return NextResponse.json({
            recommendations: [],
            brief: { headline: "Branch not available", detail: "This location is excluded from replenishment planning." },
            meta: { branch, targetDaysOfCover: TARGET_DAYS_OF_COVER, excluded: true },
        });
    }

    try {
        const [cachedPage, itemClasses] = await Promise.all([
            loadCachedPage(effectiveCompanyId, branch, {
                page,
                pageSize,
                search,
                priority,
                itemClass,
                bypassMemCache,
                liveOverlay: forceRefresh,
            }),
            getCached(
                `repl:classes:${effectiveCompanyId}:${branchKey}`,
                bypassMemCache ? 0 : MEM_CACHE_MS,
                () => MySqlService.getReplenishmentItemClasses(effectiveCompanyId, branch)
            ),
        ]);

        if (cachedPage?.meta?.itemCount != null || cachedPage?.recommendations) {
            const cacheVersion = Number(cachedPage.meta?.salesLogicVersion) || 0;
            const versionOk = cacheVersion === REPLENISHMENT_SALES_LOGIC_VERSION;
            const isMainBranch = branchKey === "MAIN";

            if (forceRefresh || !versionOk) {
                if (forceRefresh) {
                    invalidateCache(`accurateRetailDemand:`);
                    invalidateCache(`liveBranchDemand:`);
                }
                if (isMainBranch) {
                    scheduleBackgroundRebuildAll(companyId);
                } else {
                    scheduleBackgroundRebuild(branch, companyId, effectiveCompanyId);
                }
            } else {
                MySqlService.getReplenishmentDataWatermark()
                    .then((wm) => {
                        if (!isCacheFresh(cachedPage.meta?.generatedAt, wm)) {
                            scheduleBackgroundRebuild(branch, companyId, effectiveCompanyId);
                        }
                    })
                    .catch(() => {});
            }

            const recommendations = cachedPage.recommendations || [];
            const stats = {
                urgent: cachedPage.meta?.stats?.urgent ?? 0,
                soon: cachedPage.meta?.stats?.soon ?? 0,
                totalSuggested: cachedPage.meta?.stats?.totalSuggested ?? 0,
                itemCount: cachedPage.meta?.itemCount ?? recommendations.length,
            };

            if (pageSize === 0 && recommendations.length) {
                stats.urgent = recommendations.filter((r) => r.priorityLevel === "High").length;
                stats.soon = recommendations.filter((r) => r.priorityLevel === "Medium").length;
                stats.totalSuggested = recommendations.reduce((s, r) => s + (r.suggestedQty || 0), 0);
            }

            return NextResponse.json({
                recommendations,
                brief: briefFromStats(
                    { ...stats, itemCount: cachedPage.meta?.itemCount ?? stats.itemCount },
                    branch
                ),
                meta: {
                    ...cachedPage.meta,
                    itemClasses,
                    targetDaysOfCover: TARGET_DAYS_OF_COVER,
                    stockSource: "mysql",
                    salesSource: "mysql",
                    isMainWarehouseView: branchKey === "MAIN",
                    servedFrom: forceRefresh
                        ? "cache-refreshing"
                        : versionOk
                            ? "cache"
                            : "cache-stale-rebuilding",
                    salesLogicVersion: cacheVersion || cachedPage.meta?.salesLogicVersion,
                    comingPoScope: branchKey || "MAIN",
                    stockWarehouses: getStockWarehouseIdsForBranch(branch),
                    stockMetric: "qty_on_hand",
                },
            });
        }

        // Cold path only when no cache exists
        const computed = await computeReplenishmentForBranch(branch, companyId);
        await MySqlService.upsertReplenishmentCache(effectiveCompanyId, branch, computed.recommendations);
        invalidateCache(`replenishment:api:${effectiveCompanyId}:${branchKey}`);

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
                isMainWarehouseView: branchKey === "MAIN",
                stockWarehouses: getStockWarehouseIdsForBranch(branch),
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
