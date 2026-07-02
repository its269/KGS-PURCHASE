import { NextResponse } from "next/server";
import { AuthService } from "@/services/auth";
import { getSessionFromRequest, deleteSession } from "@/lib/session-store";
import { getSessionCookieOptions, withBasePath } from "@/lib/base-path";

export async function GET(request) {
    console.log("[Logout] Clearing session and redirecting to /signin");
    const authHeader = request.headers.get("Authorization");
    const sessionId = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : request.cookies.get("acu_session")?.value;
    const cookie = getSessionFromRequest(request);
    
    if (cookie) await AuthService.logout(cookie).catch(() => {});
    if (sessionId) deleteSession(sessionId);

    const signInUrl = request.nextUrl.clone();
    signInUrl.pathname = withBasePath("/signin");
    const response = NextResponse.redirect(signInUrl);
    response.cookies.set("acu_session", "", getSessionCookieOptions(request, 0));
    return response;
}
