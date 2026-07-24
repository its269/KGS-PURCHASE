/**
 * Server-side Acumatica credential for BFF routes when the user session
 * cannot call Acumatica (expired OAuth token, bypass mode, etc.).
 */
import { getSessionFromRequest } from "@/lib/session-store";

let cachedCredential = null;
let cachedExpiry = 0;

const CACHE_MS = 25 * 60 * 1000;

export async function getSystemAcumaticaCredential() {
    if (cachedCredential && Date.now() < cachedExpiry) {
        return cachedCredential;
    }

    const baseUrl = process.env.ACUMATICA_BASE_URL;
    const username = process.env.ACUMATICA_USERNAME || process.env.ACU_USERNAME;
    const password = process.env.ACUMATICA_PASSWORD || process.env.ACU_PASSWORD;
    const company = process.env.ACUMATICA_COMPANY || process.env.ACU_COMPANY;

    if (!baseUrl || !username || !password) {
        return null;
    }

    try {
        const loginRes = await fetch(`${baseUrl}/entity/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ name: username, password, company }),
        });

        if (!loginRes.ok) {
            console.error("[SystemAuth] Login failed:", loginRes.status);
            return null;
        }

        const setCookies = loginRes.headers.getSetCookie?.() || [];
        const cookieString = setCookies.map(c => c.split(";")[0]).join("; ");
        if (!cookieString) return null;

        cachedCredential = cookieString;
        cachedExpiry = Date.now() + CACHE_MS;
        return cachedCredential;
    } catch (err) {
        console.error("[SystemAuth] Login error:", err.message);
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
