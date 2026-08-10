import { getSessionIdFromRequest, getLocalUserSession } from "@/lib/session-store";
import { getLocalUserFromRequest } from "@/lib/app-users";
import { MySqlService } from "@/services/mysql";

export function summarizeActivityDetail(value) {
    if (value == null) return "";
    const s = typeof value === "string" ? value : JSON.stringify(value);
    const t = s.trim();
    if (!t) return "(cleared)";
    return t.length > 120 ? `${t.slice(0, 117)}…` : t;
}

/** Human-readable summary for stock-item dimension saves (skip null/empty). */
export function summarizeDimensionsDetail(dims) {
    if (!dims || typeof dims !== "object") return summarizeActivityDetail(dims);
    const parts = [];
    const n = (v) => (v == null || v === "" ? null : Number(v));
    const pcs = n(dims.pcs_per_box);
    const len = n(dims.length_m);
    const h = n(dims.height_m);
    const w = n(dims.width_m);
    const kg = n(dims.weight_kg);
    const cbm = n(dims.cbm);
    if (pcs != null && Number.isFinite(pcs)) parts.push(`Pcs/box ${pcs}`);
    if (len != null && Number.isFinite(len)) parts.push(`L ${len} m`);
    if (h != null && Number.isFinite(h)) parts.push(`H ${h} m`);
    if (w != null && Number.isFinite(w)) parts.push(`W ${w} m`);
    if (kg != null && Number.isFinite(kg)) parts.push(`Weight ${kg} kg`);
    if (cbm != null && Number.isFinite(cbm)) parts.push(`CBM ${cbm}`);
    return parts.length ? parts.join(" · ") : "(no values set)";
}

/** Resolve signed-in local app user from the request (Bearer / cookie session). */
export async function resolveActorFromRequest(request) {
    try {
        const user = await getLocalUserFromRequest(request);
        if (user?.id) return user;
    } catch {
        /* fall through */
    }
    const local = getLocalUserSession(getSessionIdFromRequest(request));
    if (local?.id) return local;
    return null;
}

/** Best-effort activity log — never throws to the caller. */
export async function logUserActivity(request, payload) {
    try {
        const actor = payload.userId
            ? { id: payload.userId }
            : await resolveActorFromRequest(request);
        if (!actor?.id) {
            console.warn("[ActivityLog] skipped — no local user on request", payload?.action);
            return false;
        }
        return MySqlService.logAppUserAction({
            userId: actor.id,
            action: payload.action,
            moduleName: payload.moduleName ?? null,
            refId: payload.refId ?? null,
            fieldKey: payload.fieldKey ?? null,
            detail: payload.detail ?? null,
        });
    } catch (err) {
        console.warn("[ActivityLog] failed:", err.message);
        return false;
    }
}
