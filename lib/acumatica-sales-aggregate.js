import { netQtySold } from "@/lib/sales-velocity";

/** Case-insensitive Acumatica field reader */
export function getF(obj, keyName) {
    if (!obj) return "";
    const k = Object.keys(obj).find((i) => i.toLowerCase() === keyName.toLowerCase());
    if (!k) return "";
    const val = obj[k];
    if (val === null || val === undefined) return "";
    if (Array.isArray(val)) return val;
    if (typeof val === "object") return val.value ?? "";
    return val;
}

export function getAny(obj, ...keys) {
    for (const k of keys) {
        const v = getF(obj, k);
        if (v !== "" && v !== null && v !== undefined) return v;
    }
    return "";
}

export function branchMatches(lineBranch, targetBranch) {
    if (!targetBranch || targetBranch === "All Branches") return true;
    return (
        String(lineBranch || "")
            .trim()
            .toUpperCase() === String(targetBranch).trim().toUpperCase()
    );
}

function signedQty(orderType, qty) {
    const n = Math.abs(Number(qty) || 0);
    if (orderType === "Credit Memo") return -n;
    return n;
}

function signedAmount(orderType, amount) {
    const n = Math.abs(Number(amount) || 0);
    if (orderType === "Credit Memo") return -n;
    return n;
}

function extractDetails(inv) {
    let details = inv.Details || inv.Transactions || inv.DocumentDetails || [];
    if (details && !Array.isArray(details) && details.value) details = details.value;
    return Array.isArray(details) ? details : [];
}

/**
 * Aggregate net units/revenue by inventory ID for one branch within a date range.
 * Matches the Sales page live Acumatica logic (line-level BranchID).
 */
export function aggregateBranchSales(invoices, { branch, startDate, endDate }) {
    const totals = new Map();

    for (const inv of invoices) {
        const dateStr = getAny(inv, "Date", "DocumentDate");
        if (!dateStr) continue;
        const docDate = new Date(dateStr).toISOString().split("T")[0];
        if (startDate && docDate < startDate) continue;
        if (endDate && docDate > endDate) continue;

        const headerBranch = getAny(inv, "Branch", "BranchID", "SiteID", "LinkBranch");
        const orderType = getF(inv, "Type") || "Invoice";
        const details = extractDetails(inv);

        for (const line of details) {
            const invId = String(getAny(line, "InventoryID")).trim();
            if (!invId) continue;

            const lineBranch = String(getAny(line, "BranchID", "Branch", "SiteID") || headerBranch || "").trim();
            if (!branchMatches(lineBranch, branch)) continue;

            const key = invId.toUpperCase();
            const qty = signedQty(orderType, getAny(line, "Qty", "Quantity"));
            const amount = signedAmount(orderType, getAny(line, "Amount", "ExtendedPrice"));

            const prev = totals.get(key) || { qty_sold: 0, total_sales: 0 };
            prev.qty_sold += qty;
            prev.total_sales += amount;
            totals.set(key, prev);
        }
    }

    const result = new Map();
    for (const [key, val] of totals) {
        result.set(key, {
            qty_sold: netQtySold(val.qty_sold),
            total_sales: Math.max(0, val.total_sales),
        });
    }
    return result;
}

/**
 * Flatten Acumatica invoices into rows for MySQL product_periodic_sales.
 */
export function invoicesToPeriodicSalesRows(invoices, { idPrefix = "SI", defaultOrderType = "Invoice" } = {}) {
    const rows = [];
    for (const inv of invoices) {
        const refNbr = getF(inv, "ReferenceNbr") || getF(inv, "OrderNbr");
        const headerBranch = getAny(inv, "Branch", "BranchID", "SiteID", "LinkBranch");
        const docDate = getAny(inv, "Date", "DocumentDate");
        const orderType = getF(inv, "Type") || defaultOrderType;
        const financialPeriod = getF(inv, "PostPeriod");
        const details = extractDetails(inv);

        for (const line of details) {
            const invId = getF(line, "InventoryID");
            if (!invId) continue;
            const lineNbr = getF(line, "LineNbr") || getF(line, "LineNumber") || rows.length;
            const branchName = getAny(line, "BranchID", "Branch", "SiteID") || headerBranch;

            rows.push({
                id: `${idPrefix}-${refNbr}-${lineNbr}`,
                branch_name: branchName,
                order_type: orderType,
                financial_period: financialPeriod,
                document_date: docDate ? String(docDate).split("T")[0] : null,
                description: getAny(line, "TransactionDescription", "Description", "LineDescription"),
                qty: parseFloat(getAny(line, "Qty", "Quantity") || 0),
                total_amount: parseFloat(getAny(line, "Amount", "ExtendedPrice") || 0),
                inventory_id: invId,
                last_sync: new Date(),
            });
        }
    }
    return rows;
}
