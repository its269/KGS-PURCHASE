import bcrypt from "bcryptjs";
import { getSessionIdFromRequest, getSessionMeta } from "@/lib/session-store";
import { MySqlService } from "@/services/mysql";

const BCRYPT_ROUNDS = 10;

export const APP_USER_ROLES = ["admin", "user"];

export function hashPassword(plain) {
    return bcrypt.hashSync(String(plain), BCRYPT_ROUNDS);
}

export function verifyPassword(plain, hash) {
    if (!plain || !hash) return false;
    try {
        return bcrypt.compareSync(String(plain), String(hash));
    } catch {
        return false;
    }
}

export function sanitizeUser(row) {
    if (!row) return null;
    return {
        id: Number(row.id),
        username: row.username,
        fullName: row.full_name || "",
        email: row.email || "",
        role: row.role === "admin" ? "admin" : "user",
        active: row.active === 1 || row.active === true,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null,
    };
}

export async function getLocalUserFromRequest(request) {
    const sessionId = getSessionIdFromRequest(request);
    if (!sessionId) return null;
    const meta = getSessionMeta(sessionId);
    const local = meta?.localUser;
    if (!local?.id) return null;

    // Refresh from DB so deactivated users lose access
    const fresh = await MySqlService.getAppUserById(local.id);
    if (!fresh || !(fresh.active === 1 || fresh.active === true)) return null;
    return sanitizeUser(fresh);
}

export async function requireLocalUser(request) {
    const user = await getLocalUserFromRequest(request);
    if (!user) {
        const err = new Error("Unauthorized");
        err.status = 401;
        throw err;
    }
    return user;
}

export async function requireAdmin(request) {
    const user = await requireLocalUser(request);
    if (user.role !== "admin") {
        const err = new Error("Forbidden — admin only");
        err.status = 403;
        throw err;
    }
    return user;
}

export function validateUsername(username) {
    const u = String(username || "").trim();
    if (u.length < 3 || u.length > 64) return "Username must be 3–64 characters.";
    if (!/^[a-zA-Z0-9._-]+$/.test(u)) return "Username may only contain letters, numbers, . _ -";
    return null;
}

export function validatePassword(password, { allowEmpty = false } = {}) {
    if (allowEmpty && (password === undefined || password === null || password === "")) return null;
    const p = String(password || "");
    if (p.length < 8) return "Password must be at least 8 characters.";
    if (p.length > 128) return "Password is too long.";
    return null;
}
