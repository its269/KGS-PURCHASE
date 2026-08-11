/**
 * Forecast Generator — period defaults and planning formulas.
 *
 * Last 3 months = the three complete calendar months before the current month
 * (Forecast Generator.svg: planning 4th quarter in Aug → May to July).
 * Last year same quarter = the upcoming calendar quarter, one year earlier
 * (e.g. Aug 2026 → Oct–Dec 2025).
 */

export const FORECAST_ALL_BRANCH = "*";

export function ymd(date) {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

export function lastDayOfMonth(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0);
}

const MONTH_NAMES = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function formatMonthRangeLabel(startYmd, endYmd) {
    const start = parseYmd(startYmd);
    const end = parseYmd(endYmd);
    if (!start || !end) return "";
    const sameYear = start.getFullYear() === end.getFullYear();
    const left = `${MONTH_NAMES[start.getMonth()]}${sameYear ? "" : ` ${start.getFullYear()}`}`;
    const right = `${MONTH_NAMES[end.getMonth()]} ${end.getFullYear()}`;
    return `${left} – ${right}`;
}

export function parseYmd(value) {
    const raw = String(value || "").trim();
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(d.getTime()) ? null : d;
}

export function parseMonthInput(value) {
    const raw = String(value || "").trim();
    const m = raw.match(/^(\d{4})-(\d{2})$/);
    if (!m) return null;
    const year = Number(m[1]);
    const monthIndex = Number(m[2]) - 1;
    if (!Number.isFinite(year) || monthIndex < 0 || monthIndex > 11) return null;
    return { year, monthIndex };
}

export function monthInputValue(date) {
    const d = date instanceof Date ? date : parseYmd(date);
    if (!d) return "";
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * A sales month is complete only when invoices span nearly the full calendar month.
 * Partial weeks (e.g. Jun 1–7 only) must stay "missing" so Forecast can finish the pull.
 * The current calendar month only needs coverage through today.
 */
export function monthInvoiceCoverageComplete(ym, dmin, dmax, invoiceCount = 1, asOf = new Date()) {
    if (!invoiceCount) return false;
    const [y, m] = String(ym || "").split("-").map(Number);
    if (!y || !m) return false;
    const lastDay = new Date(y, m, 0).getDate();
    const asOfDate = asOf instanceof Date && !Number.isNaN(asOf.getTime()) ? asOf : new Date();
    const expectedMax = (y === asOfDate.getFullYear() && m === asOfDate.getMonth() + 1)
        ? asOfDate.getDate()
        : lastDay;
    const minStr = String(dmin instanceof Date ? dmin.toISOString().slice(0, 10) : dmin || "").slice(0, 10);
    const maxStr = String(dmax instanceof Date ? dmax.toISOString().slice(0, 10) : dmax || "").slice(0, 10);
    const minDay = Number(minStr.slice(8, 10));
    const maxDay = Number(maxStr.slice(8, 10));
    if (!minDay || !maxDay) return false;
    return minDay <= 3 && maxDay >= Math.max(1, expectedMax - 2);
}

export function listMonthsInRange(startYmd, endYmd) {
    const start = parseYmd(startYmd);
    const end = parseYmd(endYmd);
    if (!start || !end) return [];
    const months = [];
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    const last = new Date(end.getFullYear(), end.getMonth(), 1);
    while (cursor <= last) {
        months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
        cursor.setMonth(cursor.getMonth() + 1);
    }
    return months;
}

export function rangeFromMonthInputs(startMonth, endMonth) {
    const start = parseMonthInput(startMonth);
    const end = parseMonthInput(endMonth);
    if (!start || !end) return null;
    let a = start;
    let b = end;
    if (a.year > b.year || (a.year === b.year && a.monthIndex > b.monthIndex)) {
        a = end;
        b = start;
    }
    return {
        start: ymd(new Date(a.year, a.monthIndex, 1)),
        end: ymd(lastDayOfMonth(b.year, b.monthIndex)),
    };
}

/**
 * Default planning windows as of a given date.
 * Matches Forecast Generator.svg: Last 3 Months = prior 3 complete months;
 * Last Year Same Quarter = upcoming quarter one year earlier.
 * @param {Date} [asOf]
 */
export function getDefaultForecastPeriods(asOf = new Date()) {
    const d = asOf instanceof Date ? asOf : new Date(asOf);
    const safe = Number.isNaN(d.getTime()) ? new Date() : d;
    const y = safe.getFullYear();
    const m = safe.getMonth();

    // Three complete months before the current month (Aug → May–Jul).
    const last3End = lastDayOfMonth(y, m - 1);
    const last3Start = new Date(last3End.getFullYear(), last3End.getMonth() - 2, 1);

    const currentQStart = Math.floor(m / 3) * 3;
    let upcomingQStart = currentQStart + 3;
    let upcomingYear = y;
    if (upcomingQStart > 11) {
        upcomingQStart -= 12;
        upcomingYear += 1;
    }
    const lyYear = upcomingYear - 1;
    const lyStart = new Date(lyYear, upcomingQStart, 1);
    const lyEnd = lastDayOfMonth(lyYear, upcomingQStart + 2);
    const forecastStart = new Date(upcomingYear, upcomingQStart, 1);
    const forecastEnd = lastDayOfMonth(upcomingYear, upcomingQStart + 2);

    return {
        last3Start: ymd(last3Start),
        last3End: ymd(last3End),
        lastYearStart: ymd(lyStart),
        lastYearEnd: ymd(lyEnd),
        last3Label: formatMonthRangeLabel(ymd(last3Start), ymd(last3End)),
        lastYearLabel: formatMonthRangeLabel(ymd(lyStart), ymd(lyEnd)),
        forecastQuarterLabel: formatMonthRangeLabel(ymd(forecastStart), ymd(forecastEnd)),
    };
}

export function forecastBranchKey(branch) {
    const id = String(branch || "").trim().toUpperCase();
    return id && id !== "ALL BRANCHES" ? id : FORECAST_ALL_BRANCH;
}

/** Match inventory IDs across catalog, sales, and PO (ignore spaces/case). */
export function normalizeInvKey(id) {
    return String(id || "").toUpperCase().replace(/\s+/g, "").trim();
}

/**
 * Units sold for a forecast period.
 * Prefer invoices + debit memos. If none were imported for that window,
 * fall back to other historical qty (older exports often stored sales as credit memos).
 */
export function forecastSoldQty(grossInvoiceQty, allAbsQty = 0) {
    const gross = Math.max(0, Number(grossInvoiceQty) || 0);
    if (gross > 0) return gross;
    return Math.max(0, Number(allAbsQty) || 0);
}

function toNum(value, fallback = 0) {
    if (value == null || value === "") return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * Planning math for one SKU.
 * Estimate Sales defaults to max(last 3 months, last year same quarter).
 * Target Sales defaults to Estimate + Buffer (manual override allowed).
 * For P.O. = Target − Inventory
 * Estimated Sales Amount = Target Sales × SRP
 * Net P.O. = For P.O. − Coming PO
 */
export function computeForecastFields({
    inventoryQty = 0,
    comingPo = 0,
    last3MonthsQty = 0,
    lastYearQty = 0,
    srp = 0,
    estimateSales = null,
    bufferInventory = null,
    targetSales = null,
} = {}) {
    const inv = Math.max(0, toNum(inventoryQty));
    const po = Math.max(0, toNum(comingPo));
    const last3 = Math.max(0, toNum(last3MonthsQty));
    const lastYear = Math.max(0, toNum(lastYearQty));
    const price = Math.max(0, toNum(srp));
    const suggestedEstimate = Math.max(last3, lastYear);
    const estimateIsOverride = estimateSales != null && estimateSales !== "";
    const estimate = estimateIsOverride ? Math.max(0, toNum(estimateSales)) : suggestedEstimate;
    const buffer = Math.max(0, toNum(bufferInventory));
    const suggestedTarget = estimate + buffer;
    const targetIsOverride = targetSales != null && targetSales !== "";
    const target = targetIsOverride ? Math.max(0, toNum(targetSales)) : suggestedTarget;
    const forPo = target - inv;
    const estimatedSalesAmount = target * price;
    const netPo = forPo - po;

    return {
        suggestedEstimate,
        estimateSales: estimate,
        estimateIsOverride,
        bufferInventory: buffer,
        suggestedTarget,
        targetSales: target,
        targetIsOverride,
        forPo,
        estimatedSalesAmount,
        netPo,
    };
}

export function isValidYmd(value) {
    return Boolean(parseYmd(value));
}
