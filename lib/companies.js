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
