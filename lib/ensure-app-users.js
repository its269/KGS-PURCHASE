import { MySqlService } from "@/services/mysql";
import { hashPassword } from "@/lib/app-users";

let seedPromise = null;

/**
 * Ensure app_users table exists and seed the default admin once.
 * Returns credentials only when a new admin was created.
 */
export async function ensureAppUsersReady() {
    if (seedPromise) return seedPromise;
    seedPromise = (async () => {
        await MySqlService.ensureAppUsersTable();
        const username = String(process.env.APP_ADMIN_USERNAME || "admin").trim();
        const password = String(process.env.APP_ADMIN_PASSWORD || "KelinAdmin#2026");
        const result = await MySqlService.seedDefaultAdmin({
            username,
            passwordHash: hashPassword(password),
            fullName: "System Administrator",
        });
        if (result.created) {
            console.log("══════════════════════════════════════════════");
            console.log("  KGS Purchasing — default admin created");
            console.log(`  Username: ${username}`);
            console.log(`  Password: ${password}`);
            console.log("  Change this password after first login.");
            console.log("══════════════════════════════════════════════");
            return { ...result, password };
        }
        return { ...result, password: null };
    })().catch((err) => {
        seedPromise = null;
        throw err;
    });
    return seedPromise;
}
