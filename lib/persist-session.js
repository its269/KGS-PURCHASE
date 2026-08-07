import { MySqlService } from "@/services/mysql";
import {
    getSessionMeta,
    setBypassSession,
    setLocalUserSession,
    initMultiCompanySession,
} from "@/lib/session-store";
import { sanitizeUser } from "@/lib/app-users";

/**
 * Persist a local login so it survives server restarts.
 * Sessions are removed only on explicit logout (or deactivated account).
 */
export async function persistAppSession(sessionId, userId, activeCompanyId = "main") {
    if (!sessionId || !userId) return;
    try {
        await MySqlService.upsertAppSession({
            sessionId,
            userId,
            activeCompanyId,
        });
    } catch (err) {
        console.warn("[PersistSession] save failed:", err.message);
    }
}

export async function removePersistedAppSession(sessionId) {
    if (!sessionId) return;
    try {
        await MySqlService.deleteAppSession(sessionId);
    } catch (err) {
        console.warn("[PersistSession] delete failed:", err.message);
    }
}

/**
 * Rebuild in-memory session from MySQL when the server forgot it (restart / HMR).
 * Returns true when the session is known after this call.
 */
export async function hydrateSessionFromDb(sessionId) {
    if (!sessionId) return false;
    if (getSessionMeta(sessionId)?.localUser?.id) return true;

    try {
        await MySqlService.ensureAppSessionsTable();
        const row = await MySqlService.getAppSession(sessionId);
        if (!row) return false;

        const userRow = await MySqlService.getAppUserById(row.user_id);
        if (!userRow || !(userRow.active === 1 || userRow.active === true)) {
            await MySqlService.deleteAppSession(sessionId);
            return false;
        }

        initMultiCompanySession(sessionId, {
            activeCompanyId: row.active_company_id || "main",
        });
        setBypassSession(sessionId);
        setLocalUserSession(sessionId, sanitizeUser(userRow));
        MySqlService.touchAppSession(sessionId).catch(() => {});
        return true;
    } catch (err) {
        console.warn("[PersistSession] hydrate failed:", err.message);
        return false;
    }
}
