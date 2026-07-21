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
 * Session probe for the UI — validates against Acumatica credentials
 * (cookie session or OAuth token), not only the local app session id.
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

        // OAuth token clock expiry (Acumatica access_token lifetime)
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
            deleteSession(sessionId);
            return expired({ reason: probe.reason || "acumatica_expired" });
        }

        return NextResponse.json({
            authenticated: true,
            sessionId,
            activeCompanyId,
            isBypass: !!probe.bypass || cred === "__bypass__",
            source: probe.source || "acumatica",
            degraded: !!probe.degraded,
        });
    } catch (err) {
        console.error("[Auth Session]", err);
        return expired({ reason: "error" });
    }
}
