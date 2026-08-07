/**
 * Fresh Acumatica cookie login for long-running sync jobs.
 * OAuth/user tokens expire mid-full-sync; cookie login can be refreshed.
 */
import { getSystemAcumaticaCredential } from "@/lib/acumatica-system-auth";

export async function systemLoginForCompany(acumaticaCompany) {
    const baseUrl = process.env.ACUMATICA_BASE_URL;
    const username = process.env.ACUMATICA_USERNAME || process.env.ACU_USERNAME;
    const password = process.env.ACUMATICA_PASSWORD || process.env.ACU_PASSWORD;
    const company =
        acumaticaCompany ||
        process.env.ACUMATICA_COMPANY ||
        process.env.ACU_COMPANY ||
        "";

    if (!baseUrl || !username || !password) {
        throw new Error("Acumatica system credentials are not configured in the environment.");
    }

    const loginRes = await fetch(`${baseUrl}/entity/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ name: username, password, company }),
        cache: "no-store",
    });

    if (!loginRes.ok) {
        throw new Error(`Acumatica login failed for ${company || "(default)"}: ${loginRes.status}`);
    }

    const setCookies = loginRes.headers.getSetCookie?.() || [];
    const cookieString = setCookies.map((c) => c.split(";")[0]).join("; ");
    if (!cookieString) {
        throw new Error("Acumatica login returned no session cookies.");
    }
    return cookieString;
}

export function hasSystemAcumaticaCredentials() {
    return !!(
        process.env.ACUMATICA_BASE_URL &&
        (process.env.ACUMATICA_USERNAME || process.env.ACU_USERNAME) &&
        (process.env.ACUMATICA_PASSWORD || process.env.ACU_PASSWORD)
    );
}

export function isUnauthorizedError(err) {
    const msg = String(err?.message || err || "");
    return /unauthorized|401/i.test(msg);
}

/**
 * Prefer a fresh system cookie for sync. Fall back to session credential.
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
            console.log(">>> [Sync Auth] Using fresh system Acumatica session");
            return cookie;
        } catch (err) {
            console.warn(">>> [Sync Auth] System login failed, trying session:", err.message);
        }
    }

    // Shared short-lived cache from other BFF routes
    try {
        const cached = await getSystemAcumaticaCredential();
        if (cached) return cached;
    } catch {
        /* ignore */
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
