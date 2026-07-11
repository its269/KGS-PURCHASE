/**
 * Acumatica company registry.
 * Ecommerce is a logical company in this app — stock comes from the ECOMMERCE
 * branch/site under the main Acumatica company (KGSC), not a second ERP login.
 */

export const COMPANIES = [
    {
        id: "main",
        label: process.env.ACUMATICA_COMPANY || process.env.ACU_COMPANY || "Main Company",
        acumaticaCompany: process.env.ACUMATICA_COMPANY || process.env.ACU_COMPANY || "",
        virtual: false,
    },
    {
        id: "ecommerce",
        label: process.env.ACUMATICA_ECOM_LABEL || "Ecommerce",
        /** Same Acumatica tenant as main; stock filtered by ECOMMERCE branch. */
        acumaticaCompany: process.env.ACUMATICA_COMPANY || process.env.ACU_COMPANY || "",
        virtual: true,
        branchIds: ["ECOMMERCE", "ECOM", "E-COMMERCE", "E COMMERCE"],
    },
];

/** Branch/site IDs routed to the ecommerce company bucket (excluded from main-company totals unless branch is selected). */
export const ECOM_BRANCH_ALIASES = new Set([
    "ECOM",
    "ECOMMERCE",
    "E-COMMERCE",
    "E COMMERCE",
    "ECOM BRANCH",
]);

/**
 * Non-sellable / non-replenishment locations — hidden from branch pickers and excluded from stock & sales totals.
 * Match is case-insensitive on branch_id / branch_name.
 */
export const EXCLUDED_BRANCH_ALIASES = new Set([
    "DAMAGE",
    "DISCOUNTED LOCATION",
]);

export function getCompanyById(companyId) {
    return COMPANIES.find((c) => c.id === companyId) || COMPANIES[0];
}

export function getAcumaticaCompanyName(companyId) {
    return getCompanyById(companyId).acumaticaCompany;
}

export function isValidCompanyId(companyId) {
    return COMPANIES.some((c) => c.id === companyId);
}

export function listCompaniesForClient(activeCompanyId = "main") {
    return {
        activeCompanyId,
        companies: COMPANIES.map((c) => ({
            id: c.id,
            label: c.label,
        })),
    };
}

export function isEcomBranchAlias(branchId) {
    const key = String(branchId || "").trim().toUpperCase();
    return ECOM_BRANCH_ALIASES.has(key);
}

export function isExcludedBranchAlias(branchId) {
    const key = String(branchId || "").trim().toUpperCase();
    return EXCLUDED_BRANCH_ALIASES.has(key);
}

/**
 * Retail / sellable branches eligible for replenishment planning.
 * Warehouse, tech, and office locations have stock but no POS sales at that site.
 */
export function isRetailReplenishmentBranch(branchId) {
    const key = String(branchId || "").trim().toUpperCase();
    if (!key || key === "__CATALOG__") return false;
    if (isExcludedBranchAlias(key)) return false;
    if (key === "MAIN") return true;
    if (isEcomBranchAlias(key)) return true;
    if (key.endsWith("-TECH") || key === "MNL-TECH") return false;
    if (key.includes("OFFICE")) return false;
    if (key.endsWith(" WH") || key.includes(" WH ") || key === "WH1" || key.includes("WH11")) return false;
    if (["SKYTECHMNL", "SKY ECOM", "MNL-MRILAO", "MNL CAL WH", "MAIN WH11", "TESTING"].includes(key)) return false;
    return true;
}

export function filterReplenishmentBranchList(branches) {
    return filterBranchList(branches).filter((b) => {
        const id = b.SiteID ?? b.branch_id ?? b.id ?? "";
        return isRetailReplenishmentBranch(id);
    });
}

/** Remove Damage / Discounted Location (and similar) from branch dropdown lists. */
export function filterBranchList(branches) {
    return (branches || []).filter((b) => {
        const id = b.SiteID ?? b.branch_id ?? b.id ?? "";
        return !isExcludedBranchAlias(id);
    });
}

/** SQL fragment to omit excluded branches from inventory_items queries. */
export function sqlExcludeBranches(alias = "i") {
    const branches = [...EXCLUDED_BRANCH_ALIASES];
    return {
        clause: `(${alias}.branch_id IS NULL OR TRIM(${alias}.branch_id) = '' OR UPPER(TRIM(${alias}.branch_id)) NOT IN (${branches.map(() => "?").join(", ")}))`,
        params: branches,
    };
}

/** SQL fragment to omit excluded branches from product_periodic_sales queries. */
export function sqlExcludeSalesBranches(column = "branch_name", tableAlias = "") {
    const col = tableAlias ? `${tableAlias}.${column}` : column;
    const branches = [...EXCLUDED_BRANCH_ALIASES];
    return {
        clause: `(${col} IS NULL OR TRIM(${col}) = '' OR UPPER(TRIM(${col})) NOT IN (${branches.map(() => "?").join(", ")}))`,
        params: branches,
    };
}

/** SQL fragment to omit ecommerce invoice branches from sales totals. */
export function sqlExcludeEcomSalesBranches(column = "branch_name", tableAlias = "") {
    const col = tableAlias ? `${tableAlias}.${column}` : column;
    const branches = [...ECOM_BRANCH_ALIASES];
    return {
        clause: `(${col} IS NULL OR TRIM(${col}) = '' OR UPPER(TRIM(${col})) NOT IN (${branches.map(() => "?").join(", ")}))`,
        params: branches,
    };
}

/** SQL fragment to include only ecommerce invoice branches in sales totals. */
export function sqlOnlyEcomSalesBranches(column = "branch_name", tableAlias = "") {
    const col = tableAlias ? `${tableAlias}.${column}` : column;
    const branches = [...ECOM_BRANCH_ALIASES];
    return {
        clause: `UPPER(TRIM(${col})) IN (${branches.map(() => "?").join(", ")})`,
        params: branches,
    };
}

/** When a user picks an ecommerce branch, read stock from the ecommerce company bucket. */
export function resolveCompanyIdForBranch(companyId, branchId) {
    if (branchId && isEcomBranchAlias(branchId)) return "ecommerce";
    return companyId || "main";
}

/** SQL fragment + params to hide ecommerce misclassified as a branch under main company. */
export function sqlExcludeEcomBranches(alias = "i") {
    const branches = [...ECOM_BRANCH_ALIASES];
    return {
        clause: `(${alias}.branch_id IS NULL OR TRIM(${alias}.branch_id) = '' OR UPPER(TRIM(${alias}.branch_id)) NOT IN (${branches.map(() => "?").join(", ")}))`,
        params: branches,
    };
}

/** SQL fragment to include only ecommerce branch rows. */
export function sqlOnlyEcomBranches(alias = "i") {
    const branches = [...ECOM_BRANCH_ALIASES];
    return {
        clause: `UPPER(TRIM(${alias}.branch_id)) IN (${branches.map(() => "?").join(", ")})`,
        params: branches,
    };
}

/** Split Acumatica warehouse levels into main vs ecommerce company buckets. */
export function splitLevelsByCompany(levels) {
    const main = [];
    const ecommerce = [];
    for (const level of levels) {
        if (isEcomBranchAlias(level.branch_id)) ecommerce.push(level);
        else main.push(level);
    }
    return { main, ecommerce };
}

export function isVirtualCompany(companyId) {
    return getCompanyById(companyId).virtual === true;
}
