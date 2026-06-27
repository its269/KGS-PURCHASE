/** Rolling window for average daily sales (Sells / day, Last 3 Months Sales, dead stock). */
export const SALES_LOOKBACK_DAYS = 90;

/**
 * SQL expression: net units sold (invoices + debit memos minus credit memos).
 * Use inside SUM() over product_periodic_sales.
 */
export const SQL_NET_QTY = `CASE
    WHEN order_type = 'Credit Memo' THEN -ABS(qty)
    WHEN order_type IN ('Invoice', 'Debit Memo') THEN ABS(qty)
    ELSE 0
END`;

/**
 * SQL expression: net revenue (invoices + debit memos minus credit memos).
 */
export const SQL_NET_AMOUNT = `CASE
    WHEN order_type = 'Credit Memo' THEN -ABS(total_amount)
    WHEN order_type IN ('Invoice', 'Debit Memo') THEN ABS(total_amount)
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
