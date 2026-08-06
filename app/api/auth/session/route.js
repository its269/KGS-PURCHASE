import { NextResponse } from "next/server";
import {
    getSessionIdFromRequest,
    getSessionMeta,
    getSession,
    getActiveCompanyId,
    deleteSession,
} from "@/lib/session-store";
import { AuthService } from "@/services/auth";
import { SESSION_EXPIRED_MESSAGE } from "@/lib/session-messages";
import { MySqlService } from "@/services/mysql";
import { sanitizeUser } from "@/lib/app-users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const expired = (extra = {}) =>
    NextResponse.json(
        {
            authenticated: false,
            source: "acumatica",
            message: SESSION_EXPIRED_MESSAGE,
            ...extra,
        },
        { status: 401 }
    );

/**
 * Session probe for the UI — local app users stay valid while active in DB;
 * Acumatica sessions are validated against ERP credentials.
 */
export async function GET(request) {
    try {
        const sessionId = getSessionIdFromRequest(request);
        if (!sessionId) {
            return expired({ reason: "no_local_session" });
        }

        const meta = getSessionMeta(sessionId);
        const cred = getSession(sessionId);
        if (!meta?.companies || Object.keys(meta.companies).length === 0 || !cred) {
            return expired({ reason: "local_session_missing" });
        }

        const activeCompanyId = getActiveCompanyId(sessionId) || "main";
        const companyEntry = meta.companies?.[activeCompanyId] || meta.companies?.main;

        // Local app user session
        if (meta.localUser?.id) {
            try {
                const row = await MySqlService.getAppUserById(meta.localUser.id);
                if (!row || !(row.active === 1 || row.active === true)) {
                    deleteSession(sessionId);
                    return expired({ reason: "local_user_inactive" });
                }
            } catch (err) {
                console.warn("[Auth Session] Local user check failed:", err.message);
            }

            // Bypass / degraded ERP is fine for local users
            if (cred === "__bypass__" || companyEntry?.isBypass) {
                return NextResponse.json({
                    authenticated: true,
                    sessionId,
                    activeCompanyId,
                    isBypass: true,
                    source: "local",
                    authType: "local",
                    user: sanitizeUser({
                        ...meta.localUser,
                        full_name: meta.localUser.fullName,
                        active: 1,
                    }),
                    degraded: true,
                });
            }
        }

        // OAuth token clock expiry
        if (
            companyEntry?.isTokenAuth &&
            companyEntry.acumaticaTokenExpiresAt &&
            Date.now() >= Number(companyEntry.acumaticaTokenExpiresAt)
        ) {
            deleteSession(sessionId);
            return expired({ reason: "acumatica_token_expired" });
        }

        const probe = await AuthService.validateSession(cred);
        if (!probe.ok) {
            // Local users can keep working in bypass if ERP probe fails
            if (meta.localUser?.id) {
                return NextResponse.json({
                    authenticated: true,
                    sessionId,
                    activeCompanyId,
                    isBypass: cred === "__bypass__",
                    source: "local",
                    authType: "local",
                    user: {
                        id: meta.localUser.id,
                        username: meta.localUser.username,
                        fullName: meta.localUser.fullName || "",
                        email: meta.localUser.email || "",
                        role: meta.localUser.role,
                        active: true,
                    },
                    degraded: true,
                });
            }
            deleteSession(sessionId);
            return expired({ reason: probe.reason || "acumatica_expired" });
        }

        return NextResponse.json({
            authenticated: true,
            sessionId,
            activeCompanyId,
            isBypass: !!probe.bypass || cred === "__bypass__",
            source: meta.localUser ? "local" : probe.source || "acumatica",
            authType: meta.localUser ? "local" : "acumatica",
            user: meta.localUser
                ? {
                    id: meta.localUser.id,
                    username: meta.localUser.username,
                    fullName: meta.localUser.fullName || "",
                    email: meta.localUser.email || "",
                    role: meta.localUser.role,
                    active: true,
                }
                : null,
            degraded: !!probe.degraded,
        });
    } catch (err) {
        console.error("[Auth Session]", err);
        return expired({ reason: "error" });
    }
}
