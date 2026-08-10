/** Client helper: local admin accounts are not branch-restricted. */
export function isLocalAdminUser() {
    if (typeof window === "undefined") return true;
    try {
        return localStorage.getItem("userRole") === "admin";
    } catch {
        return true;
    }
}
