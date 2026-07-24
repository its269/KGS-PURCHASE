import { getSession } from "@/lib/session-store";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request) {
    const sessionId = request.cookies.get("acu_session")?.value;
    const cookie = getSession(sessionId);
    if (!cookie) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const url = searchParams.get("url");
    if (!url) return NextResponse.json({ message: "Missing url param" }, { status: 400 });

    try {
        const res = await fetch(url, {
            headers: {
                "Accept": "application/json",
                "Cookie": cookie,
            },
            cache: "no-store",
        });
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); } catch { data = { raw: text }; }
        return NextResponse.json({ status: res.status, data });
    } catch (err) {
        return NextResponse.json({ message: err.message }, { status: 500 });
    }
}
