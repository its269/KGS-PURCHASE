import { AuthService } from "@/services/auth";
import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session-store";

export async function GET(request) {
    try {
        const cookie = getSessionFromRequest(request);
        
        if (!cookie) {
            return NextResponse.json({ fullName: "" }, { status: 200 });
        }

        if (cookie === "__bypass__") {
            return NextResponse.json({ 
                first: "Admin", 
                last: "(Bypass)", 
                fullName: "Admin (Bypass Mode)" 
            });
        }

        const { searchParams } = new URL(request.url);
        const username = searchParams.get("username") || "";

        const userInfo = await AuthService.getUserInfo(username, cookie);
        return NextResponse.json(userInfo);
    } catch (err) {
        console.error("[BFF Auth Me Error]", err);
        return NextResponse.json({ fullName: "" }, { status: 200 });
    }
}
