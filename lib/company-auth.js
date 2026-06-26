import { AuthService } from "@/services/auth";
import {
    initMultiCompanySession,
    setSession,
    setTokenSession,
    setLoginCredentials,
    setCompanyError,
    linkVirtualEcommerceCompany,
} from "@/lib/session-store";

/**
 * Authenticate the main Acumatica company (KGSC) and store credentials on the session.
 */
export async function authenticateAndStoreCompany(
    sessionId,
    { username, password, companyId, acumaticaCompany }
) {
    let usedTokenAuth = false;

    try {
        const tokenData = await AuthService.loginWithToken({
            username,
            password,
            company: acumaticaCompany || undefined,
        });
        usedTokenAuth = true;
        let backupCookies = [];
        try {
            backupCookies = await AuthService.login({
                username,
                password,
                company: acumaticaCompany || undefined,
            });
        } catch {
            /* cookie backup optional */
        }
        setTokenSession(sessionId, tokenData, backupCookies, companyId);
        return { companyId, ok: true, method: "token" };
    } catch (tokenErr) {
        console.warn(`[CompanyAuth] Token login failed for ${companyId}:`, tokenErr.message);
    }

    if (!usedTokenAuth) {
        try {
            const cookies = await AuthService.login({
                username,
                password,
                company: acumaticaCompany || undefined,
            });
            setSession(sessionId, cookies || [], companyId);
            return { companyId, ok: true, method: "cookie" };
        } catch (err) {
            console.error(`[CompanyAuth] Login failed for ${companyId}:`, err.message);
            return { companyId, ok: false, error: err.message };
        }
    }

    return { companyId, ok: false };
}

/**
 * Login to KGSC, then link ecommerce as a virtual company (shared auth, branch-split stock).
 */
export async function authenticateAllCompanies(sessionId, { username, password, activeCompanyId = "main" }) {
    const { getAcumaticaCompanyName } = await import("@/lib/companies");
    const acumaticaCompany = getAcumaticaCompanyName("main");

    initMultiCompanySession(sessionId, { activeCompanyId });
    setLoginCredentials(sessionId, username, password);

    const mainResult = await authenticateAndStoreCompany(sessionId, {
        username,
        password,
        companyId: "main",
        acumaticaCompany,
    });

    if (!mainResult.ok) {
        setCompanyError(sessionId, "main", mainResult.error || "Login failed");
        return [mainResult];
    }

    linkVirtualEcommerceCompany(sessionId);
    setCompanyError(sessionId, "ecommerce", null);
    console.log("[CompanyAuth] Ecommerce linked as virtual company (ECOMMERCE branch under KGSC)");

    return [
        mainResult,
        { companyId: "ecommerce", ok: true, method: "virtual" },
    ];
}

/** Ensure ecommerce virtual company is linked (e.g. on company switch). */
export function connectEcommerceCompany(sessionId) {
    const linked = linkVirtualEcommerceCompany(sessionId);
    if (!linked) {
        return { ok: false, error: "Main company session not found. Please sign in again." };
    }
    setCompanyError(sessionId, "ecommerce", null);
    return { ok: true, method: "virtual" };
}
