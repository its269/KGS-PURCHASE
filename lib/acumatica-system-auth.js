/**
 * Server-side Acumatica credential for BFF routes when the user session
 * cannot call Acumatica (expired OAuth token, bypass mode, etc.).
 */
import { getSessionFromRequest } from "@/lib/session-store";

let cachedCredential = null;
let cachedExpiry = 0;

const CACHE_MS = 25 * 60 * 1000;

export function getCachedSystemCredential() {
    if (cachedCredential && Date.now() < cachedExpiry) {
        return cachedCredential;
    }
    return null;
}

export function rememberSystemCredential(cookie, ttlMs = CACHE_MS) {
    if (!cookie || cookie === "__bypass__") return;
    cachedCredential = cookie;
    cachedExpiry = Date.now() + ttlMs;
}

export async function getSystemAcumaticaCredential() {
    const cached = getCachedSystemCredential();
    if (cached) return cached;

    try {
        const { systemLoginForCompany } = await import("@/lib/sync-acumatica-auth");
        const { getAcumaticaCompany } = await import("@/lib/acumatica-env");
        return await systemLoginForCompany(getAcumaticaCompany());
    } catch (err) {
        console.error("[SystemAuth] Login failed:", err.message);
        return null;
    }
}

/** Prefer user session; fall back to system service account. */
export async function resolveAcumaticaCredential(request) {
    const userCred = getSessionFromRequest(request);
    if (userCred && userCred !== "__bypass__") {
        return userCred;
    }
    return getSystemAcumaticaCredential();
}
