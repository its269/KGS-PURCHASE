/** Rolling window for average daily sales (Sells / day, Last 3 Months Sales, dead stock). */
export const SALES_LOOKBACK_DAYS = 90;

/**
 * SQL expression: net units sold (invoices + debit memos minus credit memos).
 * Use inside SUM() over product_periodic_sales.
 *
 * Credit memos are stored under CM-* (Invoice entity). SalesInvoice sync also
 * wrote duplicate Credit Memo rows as SI-* — ignore those so net matches
 * Acumatica Released profitability (invoice − CM once).
 */
export const SQL_NET_QTY = `CASE
    WHEN order_type = 'Credit Memo' AND id LIKE 'CM-%' THEN -ABS(qty)
    WHEN order_type IN ('Invoice', 'Debit Memo') THEN ABS(qty)
    ELSE 0
END`;

/**
 * SQL expression: net revenue (invoices + debit memos minus credit memos).
 */
export const SQL_NET_AMOUNT = `CASE
    WHEN order_type = 'Credit Memo' AND id LIKE 'CM-%' THEN -ABS(total_amount)
    WHEN order_type IN ('Invoice', 'Debit Memo') THEN ABS(total_amount)
    ELSE 0
END`;

/**
 * Gross outbound qty (invoices + debit memos) — used for replenishment velocity
 * when credit memos would zero out net sales in the sync cache.
 */
export const SQL_GROSS_QTY = `CASE
    WHEN order_type IN ('Invoice', 'Debit Memo') THEN ABS(qty)
    ELSE 0
END`;

/** Clamp negative net sales (returns exceed invoices) to zero for velocity metrics. */
export function netQtySold(raw) {
    return Math.max(0, Number(raw) || 0);
}

export function averageDailySales(qtySoldInPeriod, days = SALES_LOOKBACK_DAYS) {
    const window = Number(days) || SALES_LOOKBACK_DAYS;
    if (window <= 0) return 0;
    return netQtySold(qtySoldInPeriod) / window;
}

/**
 * Prefer branch-scoped sales; use fallback qty only when branch qty is zero.
 * Never take the max of branch vs network (that inflates branch Sells / day).
 */
export function mergeBranchFirstSalesMaps(branchMap, fallbackMap) {
    const branch = branchMap instanceof Map ? branchMap : new Map();
    const fallback = fallbackMap instanceof Map ? fallbackMap : new Map();
    const merged = new Map();
    const keys = new Set([...branch.keys(), ...fallback.keys()]);

    for (const key of keys) {
        const branchVal = branch.get(key);
        const fallbackVal = fallback.get(key);
        const branchQty = netQtySold(branchVal?.qty_sold);
        const fallbackQty = netQtySold(fallbackVal?.qty_sold);
        const qty = branchQty > 0 ? branchQty : fallbackQty;
        if (qty <= 0) continue;

        const salesSource = branchQty > 0 ? branchVal : fallbackVal;
        merged.set(key, {
            qty_sold: qty,
            total_sales: Math.max(0, Number(salesSource?.total_sales) || 0),
            salesScope: branchQty > 0 ? "branch" : "catalog-network",
        });
    }

    return merged;
}
