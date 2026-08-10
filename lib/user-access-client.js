/** Client helper: local admin accounts are not branch-restricted. */
export function isLocalAdminUser() {
    if (typeof window === "undefined") return true;
    try {
        return localStorage.getItem("userRole") === "admin";
    } catch {
        return true;
    }
}

export function readAllowedModules() {
    if (typeof window === "undefined") return [];
    try {
        const parsed = JSON.parse(localStorage.getItem("userModules") || "[]");
        return Array.isArray(parsed) ? parsed.map((m) => String(m || "").trim()).filter(Boolean) : [];
    } catch {
        return [];
    }
}

export function storeAllowedModules(modules) {
    if (typeof window === "undefined") return;
    try {
        localStorage.setItem("userModules", JSON.stringify(Array.isArray(modules) ? modules : []));
    } catch {
        /* ignore */
    }
}

export function clientCanAccessModule(moduleId) {
    if (!moduleId || moduleId === "account") return true;
    if (isLocalAdminUser()) return true;
    const allowed = readAllowedModules();
    if (!allowed.length) return true;
    return allowed.includes(moduleId);
}
