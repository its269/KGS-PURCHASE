import { NextResponse } from "next/server";
import { getSessionMeta } from "@/lib/session-store";
import { getSessionCookieOptions, withBasePath, getBasePath } from "@/lib/base-path";

const PUBLIC_PATHS = ["/signin", "/api/auth/login", "/api/auth/logout"];

function normalizePath(pathname) {
    const base = getBasePath();
    if (base && pathname.startsWith(base)) {
        return pathname.slice(base.length) || "/";
    }
    return pathname;
}

function redirectTo(request, pathname) {
    const url = request.nextUrl.clone();
    url.pathname = withBasePath(pathname);
    return NextResponse.redirect(url);
}

function clearSessionCookie(request, response) {
    response.cookies.set("acu_session", "", getSessionCookieOptions(request, 0));
    return response;
}

function isKnownSession(sessionId) {
    if (!sessionId) return false;
    const meta = getSessionMeta(sessionId);
    if (!meta?.companies) return false;
    return Object.keys(meta.companies).length > 0;
}

export function proxy(request) {
    const { pathname: rawPathname } = request.nextUrl;
    const pathname = normalizePath(rawPathname);

    // Allow static assets through unconditionally
    const isStatic =
        pathname.startsWith("/_next") ||
        pathname.startsWith("/favicon");

    if (isStatic) return NextResponse.next();

    const session = request.cookies.get("acu_session");
    const sessionId = session?.value ?? null;
    console.log(`[Middleware] ${request.method} ${pathname} | acu_session=${sessionId ?? "(none)"}`);

    const forceSignIn =
        request.nextUrl.searchParams.get("expired") === "1" ||
        request.nextUrl.searchParams.get("force") === "1";

    // Signed-in users visiting /signin — unless session expired or cookie is stale
    if (sessionId && pathname.startsWith("/signin")) {
        if (forceSignIn || !isKnownSession(sessionId)) {
            if (!isKnownSession(sessionId)) {
                console.log("[Middleware] Stale session cookie on /signin — clearing cookie");
                return clearSessionCookie(request, NextResponse.next());
            }
            return NextResponse.next();
        }
        console.log(`[Middleware] Already authenticated — redirecting /signin → /dashboard`);
        return redirectTo(request, "/dashboard");
    }

    // Allow auth API routes through without a session
    const isAuthApi = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
    if (isAuthApi) {
        console.log(`[Middleware] Public API path — allowing through`);
        return NextResponse.next();
    }

    // All other routes require a valid session cookie
    if (!sessionId) {
        console.log(`[Middleware] No session — redirecting ${pathname} → /signin`);
        return redirectTo(request, "/signin");
    }

    // Cookie present but server no longer knows this session (e.g. dev restart)
    if (!isKnownSession(sessionId)) {
        console.log(`[Middleware] Unknown session — clearing cookie and redirecting to /signin`);
        if (pathname.startsWith("/api/")) {
            return clearSessionCookie(request, NextResponse.next());
        }
        return clearSessionCookie(request, redirectTo(request, "/signin?expired=1"));
    }

    console.log(`[Middleware] Session valid — allowing ${pathname}`);
    return NextResponse.next();
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - api/auth (authentication endpoints)
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         * - all files in the public folder (e.g., logo, images)
         */
        "/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\..*).*)",
    ],
};
