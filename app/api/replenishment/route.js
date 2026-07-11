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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

/** Replenishment API — reads pre-computed MySQL cache; rebuilds on refresh or stale cache. */
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

    if (isExcludedBranchAlias(branch)) {
        return NextResponse.json({
            recommendations: [],
            brief: { headline: "Branch not available", detail: "This location is excluded from replenishment planning." },
            meta: { branch, targetDaysOfCover: TARGET_DAYS_OF_COVER, excluded: true },
        });
    }

    try {
        const dataWatermark = await MySqlService.getReplenishmentDataWatermark();
        let payload = null;

        if (!forceRefresh) {
            const cached = await MySqlService.getReplenishmentFromCache(effectiveCompanyId, branch);
            if (cached?.recommendations?.length && isCacheFresh(cached.meta?.generatedAt, dataWatermark)) {
                payload = {
                    recommendations: cached.recommendations,
                    brief: buildBranchBrief(cached.recommendations, branch),
                    meta: {
                        ...cached.meta,
                        targetDaysOfCover: TARGET_DAYS_OF_COVER,
                        stockSource: "mysql",
                        salesSource: "mysql",
                        isMainWarehouseView: String(branch).trim().toUpperCase() === "MAIN",
                        dataWatermark,
                        servedFrom: "cache",
                    },
                };
            }
        }

        if (!payload) {
            const computed = await computeReplenishmentForBranch(branch, companyId);
            await MySqlService.upsertReplenishmentCache(effectiveCompanyId, branch, computed.recommendations);
            payload = {
                ...computed,
                meta: {
                    ...computed.meta,
                    dataWatermark,
                    servedFrom: forceRefresh ? "live-refresh" : "live",
                },
            };
        }

        return NextResponse.json(payload);
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
