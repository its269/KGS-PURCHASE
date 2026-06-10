import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session-store";
import { AcumaticaService } from "@/services/acumatica";
import { MySqlService } from "@/services/mysql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
        const pageSize = Math.min(100, parseInt(searchParams.get("pageSize") || "50"));
        const search = (searchParams.get("search") || "").trim();
        const startDate = searchParams.get("startDate") || "";
        const status = searchParams.get("status") || "";
        const source = searchParams.get("source") || "mysql";

        if (source === "mysql") {
            try {
                const result = await MySqlService.getPurchaseOrders({ page, pageSize, search, status, startDate });
                if (result.orders.length > 0) {
                    return NextResponse.json({ ...result, source: "mysql", page, pageSize });
                }
            } catch (mError) {
                console.error("[MySQL PO Error]", mError);
            }
        }

        const cookie = getSessionFromRequest(request);
        if (!cookie) {
            return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
        }

        if (cookie === "__bypass__") {
            return NextResponse.json({ 
                orders: [], 
                hasMore: false, 
                source: "mysql-bypass-empty",
                page, 
                pageSize 
            });
        }

        const result = await AcumaticaService.getPurchaseOrders({
            page,
            pageSize,
            search,
            cookie,
            startDate,
            status
        });

        return NextResponse.json({ 
            ...result, 
            source: "acumatica",
            page, 
            pageSize 
        });
    } catch (err) {
        console.error("[PO API Error]", err);
        return NextResponse.json({ message: err.message }, { status: 500 });
    }
}


