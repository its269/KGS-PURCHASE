/**
 * Fresh Acumatica cookie login for long-running sync jobs.
 * OAuth/user tokens expire mid-full-sync; cookie login can be refreshed.
 */
import { AuthService } from "@/services/auth";
import {
    getAcumaticaBaseUrl,
    getAcumaticaCompany,
    getAcumaticaCredentialCandidates,
    unwrapEnvValue,
} from "@/lib/acumatica-env";
import {
    getCachedSystemCredential,
    rememberSystemCredential,
} from "@/lib/acumatica-system-auth";

function cookiesToString(cookies) {
    if (!Array.isArray(cookies) || cookies.length === 0) return "";
    return cookies
        .map((c) => String(c).split(";")[0].trim())
        .filter(Boolean)
        .join("; ");
}

async function loginOnce(username, password, company) {
    const cookies = await AuthService.login({
        username,
        password,
        company: company || undefined,
    });
    const cookieString = cookiesToString(cookies);
    if (!cookieString) {
        throw new Error("Acumatica login returned no session cookies.");
    }
    return cookieString;
}

export async function systemLoginForCompany(acumaticaCompany, { forceRefresh = false } = {}) {
    if (!forceRefresh) {
        const cached = getCachedSystemCredential();
        if (cached) return cached;
    }

    try {
        getAcumaticaBaseUrl();
    } catch {
        throw new Error("Acumatica system credentials are not configured in the environment.");
    }

    const candidates = getAcumaticaCredentialCandidates();
    if (!candidates.length) {
        throw new Error("Acumatica system credentials are not configured in the environment.");
    }

    const company = unwrapEnvValue(acumaticaCompany || getAcumaticaCompany() || "");

    let lastErr;
    for (let i = 0; i < candidates.length; i++) {
        const { username, password } = candidates[i];
        const label = i === 0 ? "primary" : "secondary";
        try {
            const cookie = await loginOnce(username, password, company);
            rememberSystemCredential(cookie);
            console.log(`>>> [Sync Auth] ${label} Acumatica login succeeded`);
            return cookie;
        } catch (err) {
            lastErr = err;
            console.warn(
                `>>> [Sync Auth] ${label} login${company ? ` for ${company}` : ""} failed:`,
                err.message
            );
            if (!company) continue;
            try {
                const cookie = await loginOnce(username, password, "");
                rememberSystemCredential(cookie);
                console.log(`>>> [Sync Auth] ${label} Acumatica login succeeded without company`);
                return cookie;
            } catch (err2) {
                lastErr = err2;
                console.warn(`>>> [Sync Auth] ${label} login without company failed:`, err2.message);
            }
        }
    }

    throw new Error(
        `Acumatica login failed for ${company || "(default)"}: ${lastErr?.message || "unknown error"}`
    );
}

export function hasSystemAcumaticaCredentials() {
    try {
        getAcumaticaBaseUrl();
    } catch {
        return false;
    }
    return getAcumaticaCredentialCandidates().length > 0;
}

export function isUnauthorizedError(err) {
    const msg = String(err?.message || err || "");
    return /unauthorized|401/i.test(msg);
}

/**
 * Prefer a system cookie for sync. Reuse the in-memory session when possible
 * so full sync does not burn Acumatica API login slots on every section.
 */
export async function obtainSyncCredential({
    companyName,
    sessionCookie,
    sessionId,
    getSessionCookies,
    getCompanyCredential,
} = {}) {
    if (hasSystemAcumaticaCredentials()) {
        try {
            const cookie = await systemLoginForCompany(companyName);
            console.log(">>> [Sync Auth] Using system Acumatica session");
            return cookie;
        } catch (err) {
            console.warn(">>> [Sync Auth] System login failed, trying session:", err.message);
        }
    }

    if (sessionId && typeof getSessionCookies === "function") {
        const fromCookies = getSessionCookies(sessionId, "main");
        if (fromCookies && fromCookies !== "__bypass__") return fromCookies;
    }
    if (sessionId && typeof getCompanyCredential === "function") {
        const fromCompany = getCompanyCredential(sessionId, "main");
        if (fromCompany && fromCompany !== "__bypass__") return fromCompany;
    }
    if (sessionCookie && sessionCookie !== "__bypass__") return sessionCookie;
    return null;
}
