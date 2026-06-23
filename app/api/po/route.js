import { NextResponse } from "next/server";
import { getSessionFromRequest, getPoCredentialFromRequest } from "@/lib/session-store";
import { getSystemAcumaticaCredential } from "@/lib/acumatica-system-auth";
import { AcumaticaService } from "@/services/acumatica";
import { MySqlService } from "@/services/mysql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mergeLinesFromMap(orders, lineMap) {
    return orders.map(o => {
        if (o.lines?.length) return o;
        const key = String(o.orderNbr || "").trim();
        const lines = lineMap.get(key) || lineMap.get(o.orderNbr);
        return lines?.length ? { ...o, lines } : o;
    });
}

async function persistLinesToMySQL(orders) {
    const lineRows = [];
    for (const o of orders) {
        if (!o.lines?.length) continue;
        o.lines.forEach((line, idx) => {
            lineRows.push({
                order_nbr: o.orderNbr,
                line_nbr: idx + 1,
                inventory_id: line.inventoryId,
                description: line.description,
                qty: line.qty,
                uom: line.uom,
                ext_cost: line.extCost,
                last_sync: new Date(),
            });
        });
    }
    if (lineRows.length) {
        try {
            await MySqlService.upsertPurchaseOrderDetails(lineRows);
        } catch (err) {
            console.error("[PO Persist Lines]", err.message);
        }
    }
}

async function resolvePoCredential(request) {
    const poCred = getPoCredentialFromRequest(request);
    if (poCred && poCred !== "__bypass__") return poCred;
    return getSystemAcumaticaCredential();
}

async function fetchLivePurchaseOrders(params, credential) {
    if (!credential || credential === "__bypass__") {
        throw new Error("No valid Acumatica credentials available");
    }
    return AcumaticaService.getPurchaseOrders({ ...params, cookie: credential });
}

async function enrichMissingLines(orders, params, credential) {
    if (!orders.some(o => !o.lines?.length)) return orders;
    if (!credential || credential === "__bypass__") return orders;

    const missing = orders.filter(o => !o.lines?.length).map(o => o.orderNbr);
    if (!missing.length) return orders;

    try {
        const lineMap = await AcumaticaService.getPurchaseOrderLinesByNbrs(missing, credential);
        if (lineMap.size > 0) {
            const merged = mergeLinesFromMap(orders, lineMap);
            await persistLinesToMySQL(merged.filter(o => o.lines?.length));
            return merged;
        }
    } catch (err) {
        console.error("[PO Enrich Error]", err.message);
    }

    return orders;
}

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
        const pageSize = Math.min(100, parseInt(searchParams.get("pageSize") || "50"));
        const search = (searchParams.get("search") || "").trim();
        const startDate = searchParams.get("startDate") || "";
        const status = searchParams.get("status") || "";
        const source = searchParams.get("source") || "mysql";
        const userCred = getSessionFromRequest(request);
        const poCred = await resolvePoCredential(request);

        const fetchParams = { page, pageSize, search, startDate, status };

        if (source === "mysql") {
            try {
                const result = await MySqlService.getPurchaseOrders(fetchParams);

                if (result.orders.length > 0) {
                    const allMissingLines = result.orders.every(o => !o.lines?.length);

                    if (allMissingLines && poCred) {
                        try {
                            const live = await fetchLivePurchaseOrders(fetchParams, poCred);
                            if (live.orders.length > 0 && live.orders.some(o => o.lines?.length)) {
                                await persistLinesToMySQL(live.orders);
                                return NextResponse.json({
                                    ...live,
                                    source: "acumatica",
                                    page,
                                    pageSize,
                                });
                            }
                        } catch (liveErr) {
                            console.error("[PO Live Fallback]", liveErr.message);
                        }
                    }

                    const enriched = await enrichMissingLines(result.orders, fetchParams, poCred);
                    const wasEnriched = enriched.some((o, i) => (o.lines?.length || 0) > (result.orders[i].lines?.length || 0));

                    return NextResponse.json({
                        ...result,
                        orders: enriched,
                        source: wasEnriched ? "mysql+enriched" : "mysql",
                        page,
                        pageSize,
                    });
                }
            } catch (mError) {
                console.error("[MySQL PO Error]", mError.message);
            }
        }

        if (!userCred) {
            if (!poCred) {
                return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
            }
            const result = await fetchLivePurchaseOrders(fetchParams, poCred);
            return NextResponse.json({ ...result, source: "acumatica-system", page, pageSize });
        }

        if (userCred === "__bypass__") {
            if (poCred) {
                try {
                    const result = await fetchLivePurchaseOrders(fetchParams, poCred);
                    if (result.orders.length > 0) {
                        await persistLinesToMySQL(result.orders);
                        return NextResponse.json({ ...result, source: "acumatica-system", page, pageSize });
                    }
                } catch (err) {
                    console.error("[PO Bypass Fallback]", err.message);
                }
            }
            return NextResponse.json({
                orders: [],
                hasMore: false,
                source: "mysql-bypass-empty",
                page,
                pageSize,
            });
        }

        const result = await fetchLivePurchaseOrders(fetchParams, poCred || userCred);

        return NextResponse.json({
            ...result,
            source: "acumatica",
            page,
            pageSize,
        });
    } catch (err) {
        console.error("[PO API Error]", err);
        return NextResponse.json({ message: err.message }, { status: 500 });
    }
}
