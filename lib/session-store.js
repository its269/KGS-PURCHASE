/**
 * Server-side in-memory session store.
 * Supports both cookie-based and OAuth2 Bearer token sessions.
 * The browser only holds a UUID session key (acu_session cookie).
 */
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

// Survive HMR in dev by attaching to globalThis
const store = globalThis.__acu_session_store__ ?? (globalThis.__acu_session_store__ = new Map());

export function setSession(sessionId, cookies) {
    store.set(sessionId, { cookies, expiresAt: Date.now() + SESSION_TTL_MS });
}

export function setTokenSession(sessionId, tokenData) {
    // tokenData: { access_token, refresh_token, expires_in, token_type }
    const ttl = tokenData.expires_in ? tokenData.expires_in * 1000 : SESSION_TTL_MS;
    store.set(sessionId, {
        token: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt: Date.now() + ttl,
        isTokenAuth: true,
    });
}

export function getSession(sessionId) {
    if (!sessionId) return null;
    const entry = store.get(sessionId);
    if (!entry) {
        console.warn(`[SessionStore] Session not found: ${sessionId}`);
        return null;
    }
    if (Date.now() > entry.expiresAt) {
        console.warn(`[SessionStore] Session expired: ${sessionId}`);
        store.delete(sessionId);
        return null;
    }

    // Token-based session → return a special bearer string the caller can detect
    if (entry.isTokenAuth) {
        return `__bearer__${entry.token}`;
    }

    // Bypass session (for API Limit emergencies)
    if (entry.isBypass) {
        return "__bypass__";
    }

    // Cookie-based session
    const cookieString = (entry.cookies || []).map(c => c.split(";")[0]).join("; ");
    if (!cookieString) {
        console.warn(`[SessionStore] Session exists but has no cookies: ${sessionId}`);
        return null;
    }
    return cookieString;
}

export function deleteSession(sessionId) {
    store.delete(sessionId);
}

export function getSessionFromRequest(request) {
    const authHeader = request.headers.get("Authorization");
    let sessionId = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;
    
    if (!sessionId) {
        sessionId = request.cookies.get("acu_session")?.value;
    }
    
    return getSession(sessionId);
}
