import { NextResponse } from "next/server";

const PUBLIC_PATHS = ["/signin", "/api/auth/login", "/api/auth/logout"];

export function proxy(request) {
    const { pathname } = request.nextUrl;

    // Allow static assets through unconditionally
    const isStatic =
        pathname.startsWith("/_next") ||
        pathname.startsWith("/favicon");

    if (isStatic) return NextResponse.next();

    const session = request.cookies.get("acu_session");
    console.log(`[Middleware] ${request.method} ${pathname} | acu_session=${session?.value ?? "(none)"}`);

    // If the user is already signed in and tries to visit /signin, send to dashboard
    if (session?.value && pathname.startsWith("/signin")) {
        console.log(`[Middleware] Already authenticated — redirecting /signin → /dashboard`);
        return NextResponse.redirect(new URL("/dashboard", request.url));
    }

    // Allow auth API routes through without a session
    const isAuthApi = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
    if (isAuthApi) {
        console.log(`[Middleware] Public API path — allowing through`);
        return NextResponse.next();
    }

    // All other routes require a valid session
    if (!session?.value) {
        console.log(`[Middleware] No session — redirecting ${pathname} → /signin`);
        return NextResponse.redirect(new URL("/signin", request.url));
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
