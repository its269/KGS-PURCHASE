import { AuthService } from "@/services/auth";
import { NextResponse } from "next/server";
import { setSession, setTokenSession } from "@/lib/session-store";
import { getCookiePath } from "@/lib/base-path";

export async function POST(request) {
    try {
        const { username, password, company } = await request.json();
        console.log('[Login] Attempting login for user: ' + username);

        const sessionId = crypto.randomUUID();

        // Try OAuth2 Bearer token first; also capture cookie session for PO entity access
        let usedTokenAuth = false;
        let backupCookies = [];
        try {
            const tokenData = await AuthService.loginWithToken({ username, password, company });
            usedTokenAuth = true;
            console.log('[Login] OAuth2 token login successful');
            try {
                backupCookies = await AuthService.login({ username, password, company });
                console.log('[Login] Cookie backup captured for PO access (' + (backupCookies?.length ?? 0) + ' cookie(s))');
            } catch (cookieErr) {
                console.warn('[Login] Cookie backup failed:', cookieErr.message);
            }
            setTokenSession(sessionId, tokenData, backupCookies);
        } catch (tokenErr) {
            console.warn('[Login] OAuth2 token login failed, falling back to cookie auth:', tokenErr.message);
        }

        // Fall back to cookie-based login
        if (!usedTokenAuth) {
            try {
                const cookies = await AuthService.login({ username, password, company });
                console.log('[Login] Acumatica returned ' + (cookies?.length ?? 0) + ' cookie(s)');
                setSession(sessionId, cookies || []);
            } catch (loginErr) {
                // EMERGENCY BYPASS: If API Limit is reached but credentials match .env, allow login to view MySQL data
                const isLimitError = loginErr.message?.includes("API Login Limit");
                const matchesEnv = username === process.env.ACU_USERNAME && password === process.env.ACU_PASSWORD;

                if (isLimitError && matchesEnv) {
                    console.log("[Login] API Limit reached, but credentials match .env. Implementing EMERGENCY BYPASS.");
                    // Create a special bypass session
                    globalThis.__acu_session_store__.set(sessionId, { 
                        isBypass: true, 
                        expiresAt: Date.now() + (8 * 3600 * 1000) 
                    });
                } else {
                    throw loginErr;
                }
            }
        }

        console.log('[Login] Session stored: ' + sessionId);
        const response = NextResponse.json({ success: true, sessionId });
        
        // Set the session cookie for the middleware
        response.cookies.set("acu_session", sessionId, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            path: getCookiePath(),
            maxAge: 8 * 60 * 60, // 8 hours
        });
        
        return response;
    } catch (err) {
        console.error("[BFF Login Error]", err);
        return NextResponse.json({ message: err.message || "Login failed" }, { status: 401 });
    }
}

