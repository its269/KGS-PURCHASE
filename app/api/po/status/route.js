import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session-store";
import { MySqlService } from "@/services/mysql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

/** Acumatica Purchase Order Status values used in this tenant. */
const ACUMATICA_PO_STATUSES = [
    "On Hold",
    "Open",
    "Balanced",
    "Pending Approval",
    "Pending Printing",
    "Pending Email",
    "Completed",
    "Cancelled",
    "Closed",
];

export async function PATCH(request) {
    try {
        const cookie = getSessionFromRequest(request);
        if (!cookie) {
            return NextResponse.json({ message: "Unauthorized" }, { status: 401, ...NO_STORE });
        }

        const body = await request.json();
        const orderNbr = String(body.orderNbr || "").trim();
        const status = String(body.status || "").trim();

        if (!orderNbr) {
            return NextResponse.json({ message: "orderNbr is required." }, { status: 400, ...NO_STORE });
        }
        if (!status) {
            return NextResponse.json({ message: "status is required." }, { status: 400, ...NO_STORE });
        }

        // Allow known Acumatica values; also accept current DB value variants like "Hold"
        const allowed = new Set([
            ...ACUMATICA_PO_STATUSES,
            "Hold",
            "Canceled",
        ]);
        if (!allowed.has(status)) {
            return NextResponse.json(
                { message: `Invalid status. Use one of: ${ACUMATICA_PO_STATUSES.join(", ")}` },
                { status: 400, ...NO_STORE }
            );
        }

        const normalized = status === "Hold" ? "On Hold" : status === "Canceled" ? "Cancelled" : status;
        const result = await MySqlService.updatePurchaseOrderStatus(orderNbr, normalized);
        return NextResponse.json({ ...result, source: "mysql" }, NO_STORE);
    } catch (err) {
        const status = err.status || 500;
        return NextResponse.json(
            { message: err.message || "Failed to update status" },
            { status, ...NO_STORE }
        );
    }
}
