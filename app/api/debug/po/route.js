import { NextResponse } from "next/server";
import { getSession } from "@/lib/session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACU_BASE = "https://accounting.holocrontrackertrading.com/ERP/entity/Default/20.200.001";

export async function GET(request) {
    const sessionId = request.cookies.get("acu_session")?.value;
    console.log(`[Debug PO] Request received. sessionId: ${sessionId || "(none)"}`);

    const cookie = getSession(sessionId);
    if (!cookie) {
        console.warn(`[Debug PO] Unauthorized: No valid session found for sessionId: ${sessionId || "(none)"}`);
        return NextResponse.json({ error: "Unauthorized — please log in first" }, { status: 401 });
    }

    // Fetch 1 raw PO with Details expanded to see exact field names from Acumatica
    const url = `${ACU_BASE}/PurchaseOrder?$expand=Details&$top=1`;

    console.log(`[Debug PO] GET ${url}`);

    const res = await fetch(url, {
        headers: {
            Accept: "application/json",
            Cookie: cookie,
        },
        cache: "no-store",
    });

    const data = await res.json();
    console.log("[Debug PO] Response:", JSON.stringify(data, null, 2));
    return NextResponse.json(data, { status: res.status });
}
