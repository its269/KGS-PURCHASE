/**
 * Per-account module access.
 * Empty allowedModules = all modules (default). Admins always have all modules.
 */

export const FORECAST_MODULE = "forecast-generator";

export const MODULE_ACCESS_OPTIONS = [
    { id: "all", label: "All modules" },
    { id: FORECAST_MODULE, label: "Forecast Generator only" },
];

const ALWAYS_ALLOWED_PREFIXES = [
    "/account",
    "/api/auth",
    "/api/branches",
    "/api/company",
];

const FORECAST_ONLY_PREFIXES = [
    "/forecast-generator",
    "/api/forecast-generator",
];

export function parseAllowedModules(raw) {
    if (raw == null || raw === "") return [];
    if (Array.isArray(raw)) {
        return [...new Set(raw.map((m) => String(m || "").trim()).filter(Boolean))];
    }
    const text = String(raw).trim();
    if (!text || text === "all" || text === "[]") return [];
    try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
            return [...new Set(parsed.map((m) => String(m || "").trim()).filter(Boolean))];
        }
    } catch {
        /* plain string */
    }
    if (text === FORECAST_MODULE) return [FORECAST_MODULE];
    return [];
}

export function serializeAllowedModules(modules) {
    const list = parseAllowedModules(modules);
    if (!list.length || list.includes("all")) return null;
    return JSON.stringify(list);
}

export function normalizeModuleAccessInput(value) {
    const v = String(value || "all").trim();
    if (!v || v === "all") return [];
    if (v === FORECAST_MODULE) return [FORECAST_MODULE];
    const parsed = parseAllowedModules(v);
    return parsed.includes("all") ? [] : parsed;
}

export function userHasAllModules(user) {
    if (!user || user.role === "admin") return true;
    return parseAllowedModules(user.allowedModules).length === 0;
}

export function userCanAccessModule(user, moduleId) {
    if (!moduleId) return true;
    if (userHasAllModules(user)) return true;
    return parseAllowedModules(user.allowedModules).includes(moduleId);
}

export function homePathForUser(user) {
    if (userHasAllModules(user)) return "/dashboard";
    const mods = parseAllowedModules(user?.allowedModules);
    if (mods.includes(FORECAST_MODULE)) return "/forecast-generator";
    return "/dashboard";
}

function matchesPrefix(pathname, prefix) {
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function pathAllowedForUser(user, pathname) {
    const path = String(pathname || "").split("?")[0] || "/";
    if (userHasAllModules(user)) return true;
    if (ALWAYS_ALLOWED_PREFIXES.some((p) => matchesPrefix(path, p))) return true;
    const mods = parseAllowedModules(user?.allowedModules);
    if (mods.length === 1 && mods[0] === FORECAST_MODULE) {
        return FORECAST_ONLY_PREFIXES.some((p) => matchesPrefix(path, p));
    }
    return mods.some((id) => matchesPrefix(path, `/${id}`) || matchesPrefix(path, `/api/${id}`));
}

export function moduleAccessLabel(modules) {
    const list = parseAllowedModules(modules);
    if (!list.length) return "All modules";
    if (list.length === 1 && list[0] === FORECAST_MODULE) return "Forecast Generator";
    return list.join(", ");
}

export function navItemAllowed(user, moduleId) {
    if (!moduleId) return userHasAllModules(user);
    return userCanAccessModule(user, moduleId);
}
