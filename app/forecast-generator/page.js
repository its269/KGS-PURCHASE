"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchWithAuth } from "@/lib/api-client";
import PaginationBar from "@/components/PaginationBar";
import { isLocalAdminUser } from "@/lib/user-access-client";
import {
    computeForecastFields,
    getDefaultForecastPeriods,
    monthInputValue,
} from "@/lib/forecast-generator";
import "@/styles/dashboard.css";
import "@/styles/forecast-generator.css";

const PAGE_SIZE = 10;
const DEFAULTS = getDefaultForecastPeriods();

const IconFilter = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
);
const IconSearch = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
);
const IconChevron = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9" />
    </svg>
);
const IconDownload = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
    </svg>
);
const IconRefresh = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
);

function fmtQty(n) {
    const v = Number(n) || 0;
    return v.toLocaleString("en-PH", { maximumFractionDigits: 2 });
}

function fmtMoney(n) {
    const v = Number(n) || 0;
    return `₱${v.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function displayRow(row, draft) {
    return computeForecastFields({
        inventoryQty: row.inventoryQty,
        comingPo: row.comingPo,
        last3MonthsQty: row.last3MonthsQty,
        lastYearQty: row.lastYearQty,
        srp: row.srp,
        estimateSales: draft?.estimateSales !== undefined
            ? (draft.estimateSales === "" ? null : draft.estimateSales)
            : (row.estimateIsOverride ? row.estimateSales : null),
        bufferInventory: draft?.bufferInventory !== undefined
            ? (draft.bufferInventory === "" ? 0 : draft.bufferInventory)
            : row.bufferInventory,
        targetSales: draft?.targetSales !== undefined
            ? (draft.targetSales === "" ? null : draft.targetSales)
            : (row.targetIsOverride ? row.targetSales : null),
    });
}

export default function ForecastGeneratorPage() {
    const [mounted, setMounted] = useState(false);
    const [selectedBranch, setSelectedBranch] = useState("");
    const [branchOptions, setBranchOptions] = useState([]);
    const [last3From, setLast3From] = useState(monthInputValue(DEFAULTS.last3Start));
    const [last3To, setLast3To] = useState(monthInputValue(DEFAULTS.last3End));
    const [lyFrom, setLyFrom] = useState(monthInputValue(DEFAULTS.lastYearStart));
    const [lyTo, setLyTo] = useState(monthInputValue(DEFAULTS.lastYearEnd));
    const [search, setSearch] = useState("");
    const [searchInput, setSearchInput] = useState("");
    const [itemClass, setItemClass] = useState("");
    const [itemClasses, setItemClasses] = useState([]);
    const [rows, setRows] = useState([]);
    const [drafts, setDrafts] = useState({});
    const [metrics, setMetrics] = useState({
        productCount: 0,
        inventoryQty: 0,
        last3MonthsQty: 0,
        lastYearQty: 0,
        comingPo: 0,
    });
    const [periods, setPeriods] = useState(DEFAULTS);
    const [page, setPage] = useState(1);
    const [pagination, setPagination] = useState({ totalItems: 0, totalPages: 0 });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [salesGaps, setSalesGaps] = useState([]);
    const saveTimers = useRef({});
    const gapPolls = useRef(0);
    const backfillStarted = useRef(false);

    useEffect(() => {
        Promise.resolve().then(() => {
            setMounted(true);
            try {
                const b = localStorage.getItem("fg_branch");
                const l3f = localStorage.getItem("fg_v4_last3_from");
                const l3t = localStorage.getItem("fg_v4_last3_to");
                const lyf = localStorage.getItem("fg_ly_from");
                const lyt = localStorage.getItem("fg_ly_to");
                if (b != null) setSelectedBranch(b);
                if (l3f) setLast3From(l3f);
                if (l3t) setLast3To(l3t);
                if (lyf) setLyFrom(lyf);
                if (lyt) setLyTo(lyt);
            } catch { /* ignore */ }
        });
    }, []);

    useEffect(() => {
        if (!mounted) return;
        try {
            localStorage.setItem("fg_branch", selectedBranch);
            localStorage.setItem("fg_v4_last3_from", last3From);
            localStorage.setItem("fg_v4_last3_to", last3To);
            localStorage.setItem("fg_ly_from", lyFrom);
            localStorage.setItem("fg_ly_to", lyTo);
        } catch { /* ignore */ }
    }, [mounted, selectedBranch, last3From, last3To, lyFrom, lyTo]);

    useEffect(() => {
        const t = setTimeout(() => setSearch(searchInput.trim()), 300);
        return () => clearTimeout(t);
    }, [searchInput]);

    useEffect(() => {
        if (!mounted) return;
        (async () => {
            try {
                const res = await fetchWithAuth("/api/branches");
                if (!res.ok) return;
                const list = await res.json();
                const options = (Array.isArray(list) ? list : [])
                    .map((b) => ({ id: b.SiteID || b.branch_id || "", name: b.Description || b.SiteID || "" }))
                    .filter((b) => b.id)
                    .filter((b, i, arr) => arr.findIndex((x) => x.id === b.id) === i)
                    .sort((a, z) => a.id.localeCompare(z.id));
                setBranchOptions(options);
                if (!isLocalAdminUser() && options[0] && !options.some((b) => b.id === selectedBranch)) {
                    setSelectedBranch(options[0].id);
                }
            } catch { /* ignore */ }
        })();
    }, [mounted]); // eslint-disable-line react-hooks/exhaustive-deps

    const fetchForecast = useCallback(async (pageOverride = page, { silent = false } = {}) => {
        if (!silent) {
            setLoading(true);
            setError("");
        }
        try {
            const params = new URLSearchParams({
                branch: selectedBranch,
                last3From,
                last3To,
                lyFrom,
                lyTo,
                search,
                itemClass,
                page: String(pageOverride),
                pageSize: String(PAGE_SIZE),
            });
            const res = await fetchWithAuth(`/api/forecast-generator?${params}`);
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                if (!silent) setError(body.message || "Failed to load forecast.");
                return;
            }
            const result = await res.json();
            setRows(result.data || []);
            setDrafts({});
            setMetrics(result.metrics || {});
            setItemClasses(result.itemClasses || []);
            if (result.periods) setPeriods(result.periods);
            setPagination(result.pagination || { totalItems: 0, totalPages: 0 });
            setSalesGaps(Array.isArray(result.salesGaps) ? result.salesGaps : []);
        } catch (err) {
            if (err.message === "Unauthorized") return;
            if (!silent) setError("Unable to connect to the server.");
        } finally {
            if (!silent) setLoading(false);
        }
    }, [selectedBranch, last3From, last3To, lyFrom, lyTo, search, itemClass, page]);

    useEffect(() => {
        if (!mounted) return;
        setPage(1);
    }, [selectedBranch, last3From, last3To, lyFrom, lyTo, search, itemClass, mounted]);

    useEffect(() => {
        if (!mounted) return;
        fetchForecast(page);
    }, [fetchForecast, mounted, page]);

    useEffect(() => {
        gapPolls.current = 0;
        backfillStarted.current = false;
    }, [selectedBranch, last3From, last3To, lyFrom, lyTo]);

    useEffect(() => {
        if (!mounted || !salesGaps.length || backfillStarted.current) return;
        backfillStarted.current = true;
        fetchWithAuth("/api/forecast-generator/sales-backfill", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ last3From, last3To, lyFrom, lyTo }),
        }).catch(() => {
            backfillStarted.current = false;
        });
    }, [mounted, salesGaps, last3From, last3To, lyFrom, lyTo]);

    useEffect(() => {
        if (!mounted || !salesGaps.length || gapPolls.current >= 24) return;
        const timer = setTimeout(() => {
            gapPolls.current += 1;
            fetchForecast(page, { silent: true });
        }, 15000);
        return () => clearTimeout(timer);
    }, [salesGaps, mounted, fetchForecast, page]);

    useEffect(() => {
        const onCompany = () => fetchForecast(1);
        window.addEventListener("company-changed", onCompany);
        return () => window.removeEventListener("company-changed", onCompany);
    }, [fetchForecast]);

    const persistInput = useCallback((inventoryId, nextDraft, baseRow) => {
        const computed = displayRow(baseRow, nextDraft);
        const estimateToSave = nextDraft.estimateSales !== undefined
            ? (nextDraft.estimateSales === "" || nextDraft.estimateSales == null ? null : Number(nextDraft.estimateSales))
            : (baseRow.estimateIsOverride ? Number(baseRow.estimateSales) : null);
        const bufferToSave = nextDraft.bufferInventory !== undefined
            ? (nextDraft.bufferInventory === "" || nextDraft.bufferInventory == null ? 0 : Number(nextDraft.bufferInventory))
            : Number(baseRow.bufferInventory ?? 0);
        const targetToSave = nextDraft.targetSales !== undefined
            ? (nextDraft.targetSales === "" || nextDraft.targetSales == null ? null : Number(nextDraft.targetSales))
            : (baseRow.targetIsOverride ? Number(baseRow.targetSales) : null);
        if (saveTimers.current[inventoryId]) clearTimeout(saveTimers.current[inventoryId]);
        saveTimers.current[inventoryId] = setTimeout(async () => {
            try {
                await fetchWithAuth("/api/forecast-generator", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        branch: selectedBranch,
                        inventoryId,
                        estimateSales: estimateToSave,
                        bufferInventory: bufferToSave,
                        targetSales: targetToSave,
                    }),
                });
                setRows((prev) => prev.map((r) => (
                    r.inventoryId === inventoryId
                        ? {
                            ...r,
                            ...computed,
                            estimateIsOverride: estimateToSave != null,
                            bufferInventory: bufferToSave,
                            targetIsOverride: targetToSave != null,
                            targetSales: computed.targetSales,
                        }
                        : r
                )));
            } catch { /* ignore */ }
        }, 450);
    }, [selectedBranch]);

    const updateDraft = (row, field, value) => {
        const next = { ...(drafts[row.inventoryId] || {}), [field]: value };
        setDrafts((prev) => ({ ...prev, [row.inventoryId]: next }));
        persistInput(row.inventoryId, next, row);
    };

    const resetPeriods = () => {
        const d = getDefaultForecastPeriods();
        setLast3From(monthInputValue(d.last3Start));
        setLast3To(monthInputValue(d.last3End));
        setLyFrom(monthInputValue(d.lastYearStart));
        setLyTo(monthInputValue(d.lastYearEnd));
    };

    const exportCSV = useCallback(async () => {
        try {
            const params = new URLSearchParams({
                branch: selectedBranch,
                last3From,
                last3To,
                lyFrom,
                lyTo,
                search,
                itemClass,
                page: "1",
                pageSize: "50000",
            });
            const res = await fetchWithAuth(`/api/forecast-generator?${params}`);
            if (!res.ok) return;
            const result = await res.json();
            const list = result.data || [];
            if (!list.length) return;
            const headers = [
                "Item Class", "Inventory ID", "SRP", "Item Name",
                "Inventory (as of Today)", "Coming PO (as of today)",
                `Last 3 Months (${result.periods?.last3Label || ""})`,
                `Last Year Same Quarter (${result.periods?.lastYearLabel || ""})`,
                "Estimate Sales", "Buffer Inventory", "Target Sales",
                "For P.O", "Estimated Sales Amount", "Net P.O",
            ];
            const csvRows = list.map((r) => [
                r.itemClass, r.inventoryId, r.srp, r.itemName,
                r.inventoryQty, r.comingPo, r.last3MonthsQty, r.lastYearQty,
                r.estimateSales, r.bufferInventory, r.targetSales,
                r.forPo, r.estimatedSalesAmount, r.netPo,
            ].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
            const csv = [headers.join(","), ...csvRows].join("\n");
            const blob = new Blob([csv], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `forecast-generator-${selectedBranch || "all"}-${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        } catch { /* ignore */ }
    }, [selectedBranch, last3From, last3To, lyFrom, lyTo, search, itemClass]);

    const needPoOnPage = useMemo(
        () => rows.filter((r) => displayRow(r, drafts[r.inventoryId]).netPo > 0).length,
        [rows, drafts]
    );

    return (
        <div className="db-root">
            <main className="db-main fg-main">
                <div className="db-page-title" data-tour="page-title">
                    <h1>Forecast Generator</h1>
                    <p>
                        Plan purchase quantities from last 3 months and last year same quarter.
                        {periods.forecastQuarterLabel ? ` Upcoming quarter: ${periods.forecastQuarterLabel}.` : ""}
                    </p>
                </div>

                {salesGaps.length > 0 ? (
                    <p className="fg-sales-gap">
                        Loading missing sales months from Acumatica ({salesGaps.join(", ")}).
                        Last 3 Months / Last Year will update automatically.
                    </p>
                ) : null}

                <div className="fg-period-bar" data-tour="period-params">
                    <div className="fg-period-group">
                        <label htmlFor="fg-last3-from">Last 3 Month Date</label>
                        <div className="fg-period-range">
                            <input
                                id="fg-last3-from"
                                className="fg-month-input"
                                type="month"
                                value={last3From}
                                onChange={(e) => setLast3From(e.target.value)}
                            />
                            <span className="fg-period-sep">to</span>
                            <input
                                className="fg-month-input"
                                type="month"
                                value={last3To}
                                onChange={(e) => setLast3To(e.target.value)}
                                aria-label="Last 3 months end"
                            />
                        </div>
                        <span className="fg-period-hint">{periods.last3Label || "May – Jul 2026"}</span>
                    </div>
                    <div className="fg-period-group">
                        <label htmlFor="fg-ly-from">Last Year Same Quarter</label>
                        <div className="fg-period-range">
                            <input
                                id="fg-ly-from"
                                className="fg-month-input"
                                type="month"
                                value={lyFrom}
                                onChange={(e) => setLyFrom(e.target.value)}
                            />
                            <span className="fg-period-sep">to</span>
                            <input
                                className="fg-month-input"
                                type="month"
                                value={lyTo}
                                onChange={(e) => setLyTo(e.target.value)}
                                aria-label="Last year same quarter end"
                            />
                        </div>
                        <span className="fg-period-hint">{periods.lastYearLabel || "Oct – Dec 2025"}</span>
                    </div>
                    <button type="button" className="fg-reset-btn" onClick={resetPeriods}>
                        Reset dates
                    </button>
                </div>

                <div className="db-stats fg-stats" data-tour="kpi-cards">
                    <div className="db-stat-card">
                        <span className="db-stat-label">Products</span>
                        <span className="db-stat-value">{loading && rows.length === 0 ? "..." : fmtQty(metrics.productCount)}</span>
                        <span className="db-stat-sub">In this branch / filter</span>
                    </div>
                    <div className="db-stat-card">
                        <span className="db-stat-label">Inventory today</span>
                        <span className="db-stat-value">{loading && rows.length === 0 ? "..." : fmtQty(metrics.inventoryQty)}</span>
                        <span className="db-stat-sub">On-hand / available</span>
                    </div>
                    <div className="db-stat-card">
                        <span className="db-stat-label">Last 3 months</span>
                        <span className="db-stat-value">{loading && rows.length === 0 ? "..." : fmtQty(metrics.last3MonthsQty)}</span>
                        <span className="db-stat-sub">{periods.last3Label || "Units sold"}</span>
                    </div>
                    <div className="db-stat-card">
                        <span className="db-stat-label">Last year same Q</span>
                        <span className="db-stat-value">{loading && rows.length === 0 ? "..." : fmtQty(metrics.lastYearQty)}</span>
                        <span className="db-stat-sub">{periods.lastYearLabel || "Units sold"}</span>
                    </div>
                    <div className="db-stat-card">
                        <span className="db-stat-label">Coming PO</span>
                        <span className="db-stat-value">{loading && rows.length === 0 ? "..." : fmtQty(metrics.comingPo)}</span>
                        <span className="db-stat-sub">{fmtQty(metrics.needPoCount || needPoOnPage)} still need a P.O.</span>
                    </div>
                </div>

                <div className="db-toolbar" data-tour="toolbar">
                    <div className="db-toolbar-left">
                        <div className="db-select-wrapper" data-tour="branch-filter">
                            <IconFilter />
                            <select
                                className="db-select"
                                value={selectedBranch}
                                onChange={(e) => setSelectedBranch(e.target.value)}
                                aria-label="Branch filter"
                            >
                                {isLocalAdminUser() ? <option value="">All Branches</option> : null}
                                {branchOptions.map((b) => (
                                    <option key={b.id} value={b.id}>{b.id}</option>
                                ))}
                            </select>
                            <IconChevron />
                        </div>
                        <div className="db-search-wrapper">
                            <IconSearch />
                            <input
                                className="db-search"
                                type="search"
                                placeholder="Search ID or item name..."
                                value={searchInput}
                                onChange={(e) => setSearchInput(e.target.value)}
                                aria-label="Search stock items"
                            />
                        </div>
                        <div className="fg-item-class-field">
                            <label htmlFor="fg-item-class">Item Class</label>
                            <div className="db-select-wrapper">
                                <select
                                    id="fg-item-class"
                                    className="db-select"
                                    value={itemClass}
                                    onChange={(e) => setItemClass(e.target.value)}
                                >
                                    <option value="">All Item Classes</option>
                                    {itemClasses.map((cls) => (
                                        <option key={cls} value={cls}>{cls}</option>
                                    ))}
                                </select>
                                <IconChevron />
                            </div>
                        </div>
                    </div>
                    <div className="db-toolbar-right">
                        <button className="db-action-btn" type="button" onClick={exportCSV} disabled={loading || pagination.totalItems === 0}>
                            <IconDownload /> Export CSV
                        </button>
                        <button className="db-refresh-btn" type="button" onClick={() => fetchForecast(page)} disabled={loading}>
                            <IconRefresh /> Refresh
                        </button>
                    </div>
                </div>

                <div className="fg-legend">
                    <span><i className="fg-legend-swatch fg-legend-stock" /> From stock items / sales</span>
                    <span><i className="fg-legend-swatch fg-legend-plan" /> Manual planning (Estimate + Buffer + Target)</span>
                </div>

                {error && <div className="fg-error">{error}</div>}

                <div className="db-table-wrap fg-table-wrap" data-tour="main-table">
                    <table className="db-table db-table--fit fg-table">
                        <thead>
                            <tr>
                                <th className="fg-th-stock fg-col-text">Item Class</th>
                                <th className="fg-th-stock fg-col-text">Inventory ID</th>
                                <th className="fg-th-stock fg-col-num">SRP</th>
                                <th className="fg-th-stock fg-col-text">Item Name</th>
                                <th className="fg-th-stock fg-col-num">Inventory<br />(as of Today)</th>
                                <th className="fg-th-stock fg-col-num">Coming PO<br />(as of today)</th>
                                <th className="fg-th-stock fg-col-num">Last 3 Months</th>
                                <th className="fg-th-stock fg-col-num">Last Year<br />Same Quarter</th>
                                <th className="fg-th-plan fg-col-num">Estimate Sales</th>
                                <th className="fg-th-plan fg-col-num">Buffer Inventory</th>
                                <th className="fg-th-plan fg-col-num">Target Sales</th>
                                <th className="fg-th-plan fg-col-num">For P.O</th>
                                <th className="fg-th-plan fg-col-num">Estimated Sales Amount</th>
                                <th className="fg-th-plan fg-col-num">Net P.O</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && rows.length === 0 ? (
                                <tr>
                                    <td colSpan={14} className="fg-empty">
                                        <div className="db-spinner db-spinner-lg" style={{ margin: "0 auto 0.75rem" }} />
                                        Loading forecast...
                                    </td>
                                </tr>
                            ) : rows.length === 0 ? (
                                <tr>
                                    <td colSpan={14} className="fg-empty">
                                        No stock items match this branch and search.
                                    </td>
                                </tr>
                            ) : rows.map((row) => {
                                const draft = drafts[row.inventoryId];
                                const calc = displayRow(row, draft);
                                const estimateValue = draft?.estimateSales !== undefined
                                    ? draft.estimateSales
                                    : (row.estimateIsOverride ? String(row.estimateSales) : String(calc.suggestedEstimate));
                                const bufferValue = draft?.bufferInventory !== undefined
                                    ? draft.bufferInventory
                                    : String(row.bufferInventory ?? 0);
                                const targetValue = draft?.targetSales !== undefined
                                    ? draft.targetSales
                                    : (row.targetIsOverride ? String(row.targetSales) : String(calc.suggestedTarget));
                                return (
                                    <tr key={row.inventoryId}>
                                        <td className="fg-td-stock fg-col-text">{row.itemClass || "—"}</td>
                                        <td className="fg-td-stock fg-col-text"><span className="db-inv-id">{row.inventoryId}</span></td>
                                        <td className="fg-td-stock fg-col-num">{fmtMoney(row.srp)}</td>
                                        <td className="fg-td-stock fg-col-text"><span className="db-desc" title={row.itemName}>{row.itemName}</span></td>
                                        <td className="fg-td-stock fg-col-num">{fmtQty(row.inventoryQty)}</td>
                                        <td className="fg-td-stock fg-col-num">{fmtQty(row.comingPo)}</td>
                                        <td className="fg-td-stock fg-col-num">{fmtQty(row.last3MonthsQty)}</td>
                                        <td className="fg-td-stock fg-col-num">{fmtQty(row.lastYearQty)}</td>
                                        <td className="fg-td-plan fg-col-num fg-col-input">
                                            <input
                                                className="fg-input"
                                                type="number"
                                                min="0"
                                                step="1"
                                                value={estimateValue}
                                                onChange={(e) => updateDraft(row, "estimateSales", e.target.value)}
                                                aria-label={`Estimate sales for ${row.inventoryId}`}
                                            />
                                            <span className="fg-suggested">Suggested {fmtQty(calc.suggestedEstimate)}</span>
                                        </td>
                                        <td className="fg-td-plan fg-col-num fg-col-input">
                                            <input
                                                className="fg-input"
                                                type="number"
                                                min="0"
                                                step="1"
                                                value={bufferValue}
                                                onChange={(e) => updateDraft(row, "bufferInventory", e.target.value)}
                                                aria-label={`Buffer inventory for ${row.inventoryId}`}
                                            />
                                        </td>
                                        <td className="fg-td-plan fg-col-num fg-col-input">
                                            <input
                                                className="fg-input"
                                                type="number"
                                                min="0"
                                                step="1"
                                                value={targetValue}
                                                onChange={(e) => updateDraft(row, "targetSales", e.target.value)}
                                                aria-label={`Target sales for ${row.inventoryId}`}
                                            />
                                            <span className="fg-suggested">Suggested {fmtQty(calc.suggestedTarget)}</span>
                                        </td>
                                        <td className="fg-td-plan fg-col-num">{fmtQty(calc.forPo)}</td>
                                        <td className="fg-td-plan fg-col-num">{fmtMoney(calc.estimatedSalesAmount)}</td>
                                        <td className={`fg-td-plan fg-col-num ${calc.netPo > 0 ? "fg-net-need" : "fg-net-ok"}`}>
                                            {fmtQty(calc.netPo)}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {pagination.totalItems > 0 && (
                    <PaginationBar
                        page={page}
                        pageSize={PAGE_SIZE}
                        totalCount={pagination.totalItems}
                        onPageChange={setPage}
                        itemLabel="items"
                    />
                )}

                <p className="fg-footer">
                    Target Sales defaults to Estimate + Buffer and can be typed in. For P.O = Target − Inventory.
                    Last 3 Months / Last Year = net units sold (invoices − credit memos) for the selected dates.
                    Coming PO = Open POs only (excludes On Hold), same as Replenishment.
                    Net P.O = For P.O − Coming PO. Estimated Sales Amount = Target Sales × SRP.
                </p>
            </main>
        </div>
    );
}
