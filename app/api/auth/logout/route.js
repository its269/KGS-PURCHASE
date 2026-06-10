import { NextResponse } from "next/server";
import { AuthService } from "@/services/auth";
import { getSessionFromRequest, deleteSession } from "@/lib/session-store";

export async function GET(request) {
    console.log("[Logout] Clearing session and redirecting to /signin");
    const authHeader = request.headers.get("Authorization");
    const sessionId = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : request.cookies.get("acu_session")?.value;
    const cookie = getSessionFromRequest(request);
    
    if (cookie) await AuthService.logout(cookie);
    if (sessionId) deleteSession(sessionId);

    const response = NextResponse.redirect(
        new URL("/signin", request.url)
    );
    response.cookies.set("acu_session", "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
    return response;
}
