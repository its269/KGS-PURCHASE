/**
 * Forecast Generator — period defaults and planning formulas.
 *
 * Last 3 months = previous 3 complete calendar months.
 * Last year same quarter = the upcoming calendar quarter, one year earlier
 * (e.g. 10 Aug 2026 → May–Jul 2026 and Oct–Dec 2025).
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
 * @param {Date} [asOf]
 */
export function getDefaultForecastPeriods(asOf = new Date()) {
    const d = asOf instanceof Date ? asOf : new Date(asOf);
    const safe = Number.isNaN(d.getTime()) ? new Date() : d;
    const y = safe.getFullYear();
    const m = safe.getMonth();

    const last3End = new Date(y, m, 0);
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

function toNum(value, fallback = 0) {
    if (value == null || value === "") return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * Planning math for one SKU.
 * Estimate Sales defaults to max(last 3 months, last year same quarter).
 * Target Sales = Estimate + Buffer
 * For P.O. = Target − Inventory
 * Estimated Sales Amount = Estimate × SRP
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
    const targetSales = estimate + buffer;
    const forPo = targetSales - inv;
    const estimatedSalesAmount = estimate * price;
    const netPo = forPo - po;

    return {
        suggestedEstimate,
        estimateSales: estimate,
        estimateIsOverride,
        bufferInventory: buffer,
        targetSales,
        forPo,
        estimatedSalesAmount,
        netPo,
    };
}

export function isValidYmd(value) {
    return Boolean(parseYmd(value));
}
