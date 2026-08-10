/**
 * Per-module Tour Guide — first visit only; replay from launcher or Account.
 * Applies to all signed-in users (including admin).
 */

export const TOUR_FORCE_KEY = "kgs_tour_force";
export const TOUR_REPLAY_EVENT = "kgs-tour-replay";
/** Legacy single-tour flag (migrated → inventory). */
const LEGACY_DONE_KEY = "kgs_tour_guide_done";
/** Once set, no module tour auto-starts again (Skip / leave mid-tour). */
const GLOBAL_SKIP_KEY = "kgs_tour_skipped_all";

/**
 * @typedef {{ target: string, placement?: string, title: string, body: string }} TourStep
 * @typedef {{ id: string, label: string, href: string, steps: TourStep[] }} TourModule
 */

/** @type {TourModule[]} */
export const TOUR_MODULES = [
    {
        id: "inventory",
        label: "Inventory",
        href: "/dashboard",
        steps: [
            {
                target: "page-title",
                placement: "bottom",
                title: "Inventory overview",
                body: "This module shows stock on hand and availability by item and branch. You can skip anytime and replay later from the Tour Guide button or Account.",
            },
            {
                target: "branch-filter",
                placement: "bottom",
                title: "Filter by branch",
                body: "Choose a warehouse or branch to focus stock — or keep All Branches.",
            },
            {
                target: "kpi-cards",
                placement: "bottom",
                title: "KPI cards",
                body: "Watch totals, low stock, out of stock, damage, and data freshness. Click a card for a filtered list.",
            },
            {
                target: "inventory-table",
                placement: "top",
                title: "Stock list",
                body: "Search and browse items here. Expand a row for locations, or open an item for packaging details.",
            },
        ],
    },
    {
        id: "stock-items",
        label: "Stock Items",
        href: "/stock-items",
        steps: [
            {
                target: "page-title",
                placement: "bottom",
                title: "Stock Items catalog",
                body: "Browse the product master list and configurations for every inventory ID.",
            },
            {
                target: "kpi-cards",
                placement: "bottom",
                title: "Catalog totals",
                body: "See how many product types are in the catalog at a glance.",
            },
            {
                target: "toolbar",
                placement: "bottom",
                title: "Search and tools",
                body: "Search by ID or description, and use import tools when you need to load packaging dimensions.",
            },
            {
                target: "main-table",
                placement: "top",
                title: "Product list",
                body: "Select a row to review branch availability and open item details.",
            },
        ],
    },
    {
        id: "purchase-orders",
        label: "Purchase Orders",
        href: "/purchase-orders",
        steps: [
            {
                target: "page-title",
                placement: "bottom",
                title: "Purchase Orders",
                body: "Track POs from Acumatica and add logistics notes such as container numbers and ETAs.",
            },
            {
                target: "kpi-cards",
                placement: "bottom",
                title: "PO summary",
                body: "Review order counts, pending ETAs, open status, and total value for the current page.",
            },
            {
                target: "toolbar",
                placement: "bottom",
                title: "Filters and search",
                body: "Narrow by date range, status, and branch, then search by order, vendor, or item.",
            },
            {
                target: "main-table",
                placement: "top",
                title: "Orders table",
                body: "Expand a row for line items and Total CBM. Use column filters under the headers for quick narrowing.",
            },
        ],
    },
    {
        id: "incoming-po",
        label: "Incoming PO",
        href: "/incoming-po",
        steps: [
            {
                target: "page-title",
                placement: "bottom",
                title: "Incoming Purchase Orders",
                body: "Focus on open inbound POs so receiving can see what is still coming in.",
            },
            {
                target: "toolbar",
                placement: "bottom",
                title: "Date and status filters",
                body: "Adjust From date and status to match what the warehouse needs today.",
            },
            {
                target: "main-table",
                placement: "top",
                title: "Incoming list",
                body: "Expand orders for line details and open an item ID for more product context.",
            },
        ],
    },
    {
        id: "suppliers",
        label: "Suppliers",
        href: "/suppliers",
        steps: [
            {
                target: "page-title",
                placement: "bottom",
                title: "Suppliers directory",
                body: "Manage vendors and track delivery reliability and lead times.",
            },
            {
                target: "kpi-cards",
                placement: "bottom",
                title: "Supplier stats",
                body: "See how many suppliers you have and how many have lead times recorded.",
            },
            {
                target: "toolbar",
                placement: "bottom",
                title: "Find a supplier",
                body: "Search by supplier ID or name to jump to the right vendor quickly.",
            },
            {
                target: "main-table",
                placement: "top",
                title: "Supplier rows",
                body: "Click a supplier to review their purchase order history and reliability score.",
            },
        ],
    },
    {
        id: "replenishment",
        label: "Replenishment",
        href: "/replenishment",
        steps: [
            {
                target: "page-title",
                placement: "bottom",
                title: "Replenishment planning",
                body: "See what to order or transfer based on stock and sales velocity.",
            },
            {
                target: "kpi-cards",
                placement: "bottom",
                title: "Urgency summary",
                body: "Urgent and Order soon cards highlight items that need attention first.",
            },
            {
                target: "toolbar",
                placement: "bottom",
                title: "Priority filters",
                body: "Filter by urgency and adjust branch or search to focus the list.",
            },
            {
                target: "main-table",
                placement: "top",
                title: "Recommendations",
                body: "Review suggested quantities and export when you are ready to act.",
            },
        ],
    },
    {
        id: "forecast-generator",
        label: "Forecast Generator",
        href: "/forecast-generator",
        steps: [
            {
                target: "page-title",
                placement: "bottom",
                title: "Forecast Generator",
                body: "Plan purchase quantities using last 3 months and last year same quarter. Skip anytime and replay later from Tour Guide or Account.",
            },
            {
                target: "period-params",
                placement: "bottom",
                title: "Date parameters",
                body: "Set Last 3 Month Date and Last Year Same Quarter. Defaults for August 2026 are May–July 2026 and October–December 2025.",
            },
            {
                target: "branch-filter",
                placement: "bottom",
                title: "Branch filter",
                body: "Choose a branch to change inventory, coming PO, and sales on the table.",
            },
            {
                target: "main-table",
                placement: "top",
                title: "Planning table",
                body: "Blue columns come from stock items. Amber columns are planning: enter Estimate Sales and Buffer Inventory; Target, For P.O, amount, and Net P.O update automatically.",
            },
        ],
    },
    {
        id: "sales",
        label: "Last 3 Months Sales",
        href: "/sales",
        steps: [
            {
                target: "page-title",
                placement: "bottom",
                title: "90-day sales",
                body: "Compare sales across three 30-day blocks to spot trends.",
            },
            {
                target: "kpi-cards",
                placement: "bottom",
                title: "Volume and revenue",
                body: "Check total units and revenue for the selected reporting window.",
            },
            {
                target: "toolbar",
                placement: "bottom",
                title: "As-of date and branch",
                body: "Change the reporting date and branch scope, then export CSV if needed.",
            },
            {
                target: "main-table",
                placement: "top",
                title: "Sales breakdown",
                body: "Scan item performance across each 30-day period in the table.",
            },
        ],
    },
    {
        id: "syncing",
        label: "Syncing Center",
        href: "/syncing",
        steps: [
            {
                target: "page-title",
                placement: "bottom",
                title: "Syncing Center",
                body: "Pull fresh data from Acumatica into MySQL so every module stays up to date.",
            },
            {
                target: "sync-modes",
                placement: "bottom",
                title: "Choose a sync mode",
                body: "Use Quick Sync for routine updates, Full Sync for a complete refresh, or Import File for offline loads.",
            },
            {
                target: "main-table",
                placement: "top",
                title: "History and progress",
                body: "Watch live progress while syncing and review past runs in the history list.",
            },
        ],
    },
    {
        id: "admin",
        label: "Admin",
        href: "/admin",
        steps: [
            {
                target: "page-title",
                placement: "bottom",
                title: "Admin — users",
                body: "Create and manage local login accounts for KGS PURCHASE. (Admins only.)",
            },
            {
                target: "toolbar",
                placement: "bottom",
                title: "Create or edit users",
                body: "Add a username, password, role, and branch access, or edit an existing account from the list.",
            },
            {
                target: "main-table",
                placement: "top",
                title: "User list",
                body: "See who can sign in, their roles, branch access, and whether each account is active.",
            },
        ],
    },
    {
        id: "account",
        label: "Account",
        href: "/account",
        steps: [
            {
                target: "page-title",
                placement: "bottom",
                title: "Your account",
                body: "Manage your password and replay any module tour from here.",
            },
            {
                target: "tour-replay-panel",
                placement: "bottom",
                title: "Replay tours",
                body: "Each module has its own tour. Use Replay to see a guide again. If you Skip once, auto-tours stop on every module — Replay still works anytime.",
            },
            {
                target: "password-panel",
                placement: "top",
                title: "Change password",
                body: "Update your login password anytime. You will use the new password on the next sign-in.",
            },
        ],
    },
];

export function getModuleById(id) {
    return TOUR_MODULES.find((m) => m.id === id) || null;
}

export function getModuleIdFromPath(pathname) {
    const path = String(pathname || "").split("?")[0].replace(/\/$/, "") || "/";
    if (path === "/dashboard" || path.startsWith("/dashboard/")) return "inventory";
    if (path.startsWith("/stock-items")) return "stock-items";
    if (path.startsWith("/purchase-orders")) return "purchase-orders";
    if (path.startsWith("/incoming-po")) return "incoming-po";
    if (path.startsWith("/suppliers")) return "suppliers";
    if (path.startsWith("/replenishment")) return "replenishment";
    if (path.startsWith("/forecast-generator")) return "forecast-generator";
    if (path.startsWith("/sales")) return "sales";
    if (path.startsWith("/syncing")) return "syncing";
    if (path.startsWith("/admin")) return "admin";
    if (path.startsWith("/account")) return "account";
    return null;
}

function doneKey(moduleId) {
    return `kgs_tour_done_${moduleId}`;
}

function migrateLegacyInventoryFlag() {
    try {
        if (localStorage.getItem(LEGACY_DONE_KEY) === "1") {
            localStorage.setItem(doneKey("inventory"), "1");
            localStorage.removeItem(LEGACY_DONE_KEY);
        }
    } catch {
        /* ignore */
    }
}

function readLocalPrefs() {
    migrateLegacyInventoryFlag();
    const modules = {};
    for (const m of TOUR_MODULES) {
        if (localStorage.getItem(doneKey(m.id)) === "1") modules[m.id] = true;
    }
    return {
        skippedAll: localStorage.getItem(GLOBAL_SKIP_KEY) === "1",
        modules,
    };
}

function writeLocalPrefs(prefs) {
    try {
        if (prefs.skippedAll) localStorage.setItem(GLOBAL_SKIP_KEY, "1");
        else localStorage.removeItem(GLOBAL_SKIP_KEY);
        for (const m of TOUR_MODULES) {
            if (prefs.modules?.[m.id]) localStorage.setItem(doneKey(m.id), "1");
            else localStorage.removeItem(doneKey(m.id));
        }
    } catch {
        /* ignore */
    }
}

function mergePrefs(a, b) {
    const modules = { ...(a.modules || {}) };
    for (const [k, v] of Object.entries(b.modules || {})) {
        if (v) modules[k] = true;
    }
    return {
        skippedAll: Boolean(a.skippedAll || b.skippedAll),
        modules,
    };
}

function prefsEqual(a, b) {
    if (Boolean(a.skippedAll) !== Boolean(b.skippedAll)) return false;
    for (const m of TOUR_MODULES) {
        if (Boolean(a.modules?.[m.id]) !== Boolean(b.modules?.[m.id])) return false;
    }
    return true;
}

async function pushPrefsToServer(prefs) {
    try {
        const { fetchWithAuth } = await import("@/lib/api-client");
        await fetchWithAuth("/api/auth/tour-prefs", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(prefs),
        });
    } catch (err) {
        console.error("[Tour prefs] Failed to sync to server", err);
    }
}

/**
 * Load tour progress for the signed-in user from the server (cross-device),
 * merge with any local cache, and persist the merged result.
 * Call once before auto-starting tours.
 */
export async function syncTourPrefsFromServer() {
    if (typeof window === "undefined") return readLocalPrefs();
    migrateLegacyInventoryFlag();
    const local = readLocalPrefs();
    try {
        const { fetchWithAuth } = await import("@/lib/api-client");
        const res = await fetchWithAuth("/api/auth/tour-prefs");
        if (!res.ok) {
            writeLocalPrefs(local);
            return local;
        }
        const remote = await res.json();
        const merged = mergePrefs(
            {
                skippedAll: Boolean(remote?.skippedAll),
                modules: remote?.modules && typeof remote.modules === "object" ? remote.modules : {},
            },
            local
        );
        writeLocalPrefs(merged);
        if (!prefsEqual(merged, remote)) {
            await pushPrefsToServer(merged);
        }
        return merged;
    } catch (err) {
        console.error("[Tour prefs] Failed to load from server", err);
        return local;
    }
}

/** True after Skip (or leaving a tour mid-way) — blocks auto-start on every module. */
export function isTourGloballySkipped() {
    try {
        migrateLegacyInventoryFlag();
        return localStorage.getItem(GLOBAL_SKIP_KEY) === "1";
    } catch {
        return false;
    }
}

export function isTourDone(moduleId) {
    if (!moduleId) return true;
    try {
        migrateLegacyInventoryFlag();
        if (localStorage.getItem(GLOBAL_SKIP_KEY) === "1") return true;
        return localStorage.getItem(doneKey(moduleId)) === "1";
    } catch {
        return false;
    }
}

export function markTourDone(moduleId) {
    if (!moduleId) return;
    try {
        localStorage.setItem(doneKey(moduleId), "1");
        const prefs = readLocalPrefs();
        void pushPrefsToServer(prefs);
    } catch {
        /* ignore */
    }
}

/** Skip dismisses auto-tours for every module (Replay still works). Synced to account. */
export function markAllToursSkipped() {
    try {
        localStorage.setItem(GLOBAL_SKIP_KEY, "1");
        for (const m of TOUR_MODULES) {
            localStorage.setItem(doneKey(m.id), "1");
        }
        void pushPrefsToServer(readLocalPrefs());
    } catch {
        /* ignore */
    }
}

export function clearTourDone(moduleId) {
    if (!moduleId) return;
    try {
        localStorage.removeItem(doneKey(moduleId));
        void pushPrefsToServer(readLocalPrefs());
    } catch {
        /* ignore */
    }
}

/** Clear global skip flag (Replay does not need this — force flag opens tour anyway). */
export function clearGlobalTourSkip() {
    try {
        localStorage.removeItem(GLOBAL_SKIP_KEY);
        void pushPrefsToServer(readLocalPrefs());
    } catch {
        /* ignore */
    }
}

/** Force-open a module tour (optionally navigate via href). */
export function requestTourReplay(moduleId) {
    if (!moduleId) return;
    try {
        sessionStorage.setItem(TOUR_FORCE_KEY, moduleId);
    } catch {
        /* ignore */
    }
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(TOUR_REPLAY_EVENT, { detail: { moduleId } }));
    }
}

export function consumeTourForce() {
    try {
        const raw = sessionStorage.getItem(TOUR_FORCE_KEY);
        if (!raw) return null;
        sessionStorage.removeItem(TOUR_FORCE_KEY);
        return raw;
    } catch {
        return null;
    }
}

export function peekTourForce() {
    try {
        return sessionStorage.getItem(TOUR_FORCE_KEY);
    } catch {
        return null;
    }
}
