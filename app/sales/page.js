"use client";

import { useState, useCallback, useEffect, memo, Fragment, useMemo } from "react";
import { useRouter } from "next/navigation";
import { DataCache } from "@/lib/data-cache";
import { fetchWithAuth } from "@/lib/api-client";
import "@/styles/dashboard.css";

/* ── SVG Icons ───────────────────────────────────── */
const CalendarIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
);
const DownloadIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
);
const BranchIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
);
const IconChevronLeft = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15 18 9 12 15 6" />
    </svg>
);
const IconChevronRight = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 18 15 12 9 6" />
    </svg>
);

const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];

const currentYearNum = new Date().getFullYear();
const years = Array.from({ length: 6 }, (_, i) => currentYearNum - i);

export default function SalesPeriodicPage() {
    const router = useRouter();
    const [mounted, setMounted] = useState(false);

    /* ── State ────────────────────────────────────────────── */
    const [selectedBranch, setSelectedBranch] = useState("");
    const [targetDate, setTargetDate] = useState(new Date().toISOString().split('T')[0]);
    const [branchOptions, setBranchOptions] = useState([]);
    const [allSalesData, setAllSalesData] = useState([]);
    const [periods, setPeriods] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize] = useState(15);
    const [pagination, setPagination] = useState({ totalItems: 0, totalPages: 0 });
    const [metrics, setMetrics] = useState({ overallStocks: 0, totalRevenue: 0, uniqueProducts: 0, totalQtySold: 0 });

    // Initial restoration & Hydration fix
    useEffect(() => {
        Promise.resolve().then(() => {
            setMounted(true);
            const b = localStorage.getItem("sales_filter_branch") || "";
            const d = localStorage.getItem("sales_filter_date") || new Date().toISOString().split('T')[0];

            if (b) setSelectedBranch(b);
            if (d) setTargetDate(d);

            const params = new URLSearchParams({
                branch: b,
                asOfDate: d
            });
            const cached = DataCache.get(`sales_90d_${params.toString()}`);
            if (cached) {
                setAllSalesData(cached.data || []);
                setPeriods(cached.months || []);
                setPagination(cached.pagination || { totalItems: 0, totalPages: 0 });
                setMetrics(cached.metrics || { overallStocks: 0, totalRevenue: 0, uniqueProducts: 0, totalQtySold: 0 });
            }
        });
    }, []);

    // Derived state: current page slice
    const salesData = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        const end = start + pageSize;
        return allSalesData.slice(start, end);
    }, [allSalesData, currentPage, pageSize]);

    // Save filters to localStorage when they change
    useEffect(() => {
        if (!mounted) return;
        localStorage.setItem("sales_filter_branch", selectedBranch);
        localStorage.setItem("sales_filter_date", targetDate);
    }, [selectedBranch, targetDate, mounted]);

    /* ── Fetch branches ─────────────────────────────────── */
    useEffect(() => {
        const fetchBranches = async () => {
            const cacheKey = "branches";
            const cached = DataCache.get(cacheKey);
            
            // Handle both legacy string cache and new object cache
            if (cached && Array.isArray(cached) && cached.length > 0) {
                const normalized = cached.map(b => typeof b === 'string' ? { id: b, name: b } : b);
                setBranchOptions(normalized);
            }

            try {
                const res = await fetch("/api/branches");
                if (res.ok) {
                    const data = await res.json();
                    const list = Array.isArray(data) ? data : (data?.value || []);
                    
                    const options = list.map(b => {
                        const rawName = b.Description?.value || b.BranchName?.value || b.branch_name || "";
                        const name = rawName && !rawName.startsWith("[object") ? rawName : (b.SiteID || b.branch_id || "");
                        return { id: b.SiteID || b.branch_id || "", name };
                    })
                    .filter(b => b.id)
                    .filter((b, i, arr) => arr.findIndex(x => x.id === b.id) === i)
                    .sort((a, z) => a.name.localeCompare(z.name));

                    setBranchOptions(options);
                    DataCache.set(cacheKey, options);
                }
            } catch { }
        };
        fetchBranches();
    }, []);

    /* ── Fetch sales analysis ───────────────────────────── */
    const fetchSales = useCallback(async (isBackground = false) => {
        if (!isBackground) {
            setLoading(true);
            setError("");
            setAllSalesData([]);
            setPeriods([]);
            setCurrentPage(1);

            if (typeof window !== "undefined") {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        }
        try {
            const params = new URLSearchParams({
                branch: selectedBranch,
                asOfDate: targetDate,
            });
            const cacheKey = `sales_90d_${params.toString()}`;

            const res = await fetchWithAuth(`/api/sales-periodic?${params.toString()}`);
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                if (!isBackground) setError(body.message || "Failed to load sales history.");
                return;
            }
            const result = await res.json();
            setAllSalesData(result.data || []);
            setPeriods(result.months || []);
            setPagination(result.pagination || { totalItems: 0, totalPages: 0 });
            setMetrics(result.metrics || { overallStocks: 0, totalRevenue: 0, uniqueProducts: 0, totalQtySold: 0 });
            DataCache.set(cacheKey, result);
        } catch (err) {
            if (err.message === "Unauthorized") return;
            if (!isBackground) setError("Unable to connect to the server.");
        } finally {
            setLoading(false);
        }
    }, [selectedBranch, targetDate]);

    useEffect(() => {
        if (!mounted) return;
        const params = new URLSearchParams({
            branch: selectedBranch,
            asOfDate: targetDate
        });
        const cacheKey = `sales_90d_${params.toString()}`;
        const cached = DataCache.get(cacheKey);
        if (cached) {
            Promise.resolve().then(() => fetchSales(true));
        } else {
            Promise.resolve().then(() => fetchSales(false));
        }
    }, [fetchSales, selectedBranch, targetDate, mounted]);

    /* ── Export CSV ─────────────────────────────────────── */
    const exportCSV = useCallback(() => {
        const headers = ["Inventory ID", "Branch Name", "Description"];
        periods.forEach(p => {
            headers.push(`${p.label} Qty`);
            headers.push(`${p.label} Sales`);
        });
        headers.push("90-Day Total Qty");
        headers.push("90-Day Total Sales");

        const rows = allSalesData.map((r) => {
            const row = [r.inventoryId, r.branchName, r.description];
            periods.forEach(p => {
                row.push(r.monthlyData[p.key]?.qty || 0);
                row.push(r.monthlyData[p.key]?.sales || 0);
            });
            row.push(r.totalQty);
            row.push(r.totalSales);
            return row.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",");
        });

        const csv = [headers.join(","), ...rows].join("\n");
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `sales-90days-${selectedBranch || "all"}-${targetDate}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }, [allSalesData, selectedBranch, targetDate, periods]);

    return (
        <div className="db-root">
            <main className="db-main">
                <div className="db-page-title">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <h1>90-Day Sales Analysis</h1>
                            <p>Comparative sales performance over the last 90 days, divided into three 30-day blocks.</p>
                        </div>
                        <button className="db-action-btn" onClick={exportCSV} disabled={allSalesData.length === 0}>
                            <DownloadIcon /> Export CSV
                        </button>
                    </div>
                </div>

                <div className="db-stats">
                    <div className="db-stat-card db-stat-blue">
                        <span className="db-stat-label">90-Day Total Volume</span>
                        <span className="db-stat-value">{allSalesData.length > 0 ? metrics.totalQtySold.toLocaleString() : "—"}</span>
                        <span className="db-stat-sub">Units Sold</span>
                    </div>
                    <div className="db-stat-card">
                        <span className="db-stat-label">90-Day Total Revenue</span>
                        <span className="db-stat-value">{allSalesData.length > 0 ? `₱${metrics.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 0 })}` : "—"}</span>
                        <span className="db-stat-sub">Gross Sales</span>
                    </div>
                    <div className="db-stat-card">
                        <span className="db-stat-label">Reporting As Of</span>
                        <span className="db-stat-value" style={{ fontSize: '1.25rem' }}>{new Date(targetDate).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
                        <span className="db-stat-sub">End Date</span>
                    </div>
                    <div className="db-stat-card">
                        <span className="db-stat-label">Scope</span>
                        <span className="db-stat-value" style={{ fontSize: '1.1rem' }}>{selectedBranch || "All Branches"}</span>
                        <span className="db-stat-sub">Branch Selection</span>
                    </div>
                </div>

                <section className="db-toolbar" style={{ height: 'auto', padding: '1.25rem' }}>
                    <div className="db-toolbar-left" style={{ flexWrap: 'wrap', gap: '1.5rem' }}>
                        <div className="db-sales3m-filter-group">
                            <label><CalendarIcon /> As of Date</label>
                            <div className="db-date-wrapper" style={{ minWidth: '200px' }}>
                                <input 
                                    type="date" 
                                    className="db-select" 
                                    style={{ padding: '0.65rem 1rem' }}
                                    value={targetDate}
                                    onChange={(e) => setTargetDate(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="db-sales3m-filter-group">
                            <label><BranchIcon /> Branch / Warehouse</label>
                            <div className="db-select-wrapper" style={{ minWidth: '220px' }}>
                                <select className="db-select" value={selectedBranch} onChange={(e) => setSelectedBranch(e.target.value)}>
                                    <option value="">All Branches</option>
                                    {branchOptions.map((b) => (
                                        <option key={b.id || b} value={b.id || b}>{b.name || b}</option>
                                    ))}
                                </select>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ right: '0.9rem' }}><path d="m6 9 6 6 6-9" /></svg>
                            </div>
                        </div>
                    </div>

                    <div className="db-toolbar-right" style={{ alignSelf: 'flex-end' }}>
                        <button
                            type="button"
                            className="db-btn-run-analysis"
                            onClick={() => fetchSales()}
                            disabled={loading}
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', minWidth: '160px' }}
                        >
                            {loading && <div className="db-spinner" style={{ width: '16px', height: '16px', borderWidth: '2.5px', borderTopColor: 'var(--text-inverse)' }}></div>}
                            <span>{loading ? "Analyzing..." : "Run Analysis"}</span>
                        </button>
                    </div>
                </section>

                {error && <div className="db-error-card"><div className="db-error-body"><div className="db-error-title">Error</div><div className="db-error-msg">{error}</div></div></div>}

                {loading && allSalesData.length === 0 ? (
                    <div className="db-loading">
                        <div className="db-spinner db-spinner-lg"></div>
                        <p>Aggregating 90-day data from database...</p>
                    </div>
                ) : (
                    <>
                        <div className="db-table-wrap">
                            <table className="db-table">
                                <thead>
                                    <tr>
                                        <th rowSpan={2} style={{ verticalAlign: 'middle' }}>Inventory ID</th>
                                        <th rowSpan={2} style={{ verticalAlign: 'middle' }}>Branch</th>
                                        <th rowSpan={2} style={{ verticalAlign: 'middle', width: '300px' }}>Description</th>
                                        {periods.map(p => (
                                            <th key={p.key} colSpan={2} className="db-centered-header" style={{ textAlign: 'center' }}>
                                                <div style={{ fontSize: '0.85rem' }}>{p.label}</div>
                                                <div style={{ fontSize: '0.65rem', fontWeight: '500', color: 'var(--text-secondary)', marginTop: '2px' }}>{p.range}</div>
                                            </th>
                                        ))}
                                        <th rowSpan={2} className="db-num" style={{ verticalAlign: 'middle', fontWeight: '800' }}>90-DAY QTY</th>
                                        <th rowSpan={2} className="db-num" style={{ verticalAlign: 'middle', fontWeight: '800' }}>90-DAY SALES</th>
                                    </tr>
                                    <tr>
                                        {periods.map(p => (
                                            <Fragment key={`${p.key}-sub`}>
                                                <th className="db-num" style={{ background: 'var(--bg-main)', fontSize: '0.65rem' }}>QTY</th>
                                                <th className="db-num" style={{ background: 'var(--bg-surface)', fontSize: '0.65rem', borderLeft: '1px solid var(--border-light)' }}>SALES</th>
                                            </Fragment>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {salesData.length === 0 ? (
                                        <tr>
                                            <td colSpan={5 + (periods.length * 2)} className="db-empty" style={{ textAlign: 'center', padding: '4rem' }}>
                                                <p>No data found for the 90-day period ending on {targetDate}.</p>
                                                <span>Try syncing more history or selecting a different date.</span>
                                            </td>
                                        </tr>
                                    ) : (
                                        salesData.map((row) => (
                                            <tr key={`${row.inventoryId}-${row.branchName}`}>
                                                <td><code className="db-inv-id">{row.inventoryId}</code></td>
                                                <td><span className="db-branch-tag">{row.branchName}</span></td>
                                                <td className="db-desc" style={{ fontSize: '0.8rem' }}>{row.description}</td>
                                                {periods.map(p => (
                                                    <Fragment key={p.key}>
                                                        <td className="db-num">{(row.monthlyData[p.key]?.qty || 0).toLocaleString()}</td>
                                                        <td className="db-num">₱{(row.monthlyData[p.key]?.sales || 0).toLocaleString(undefined, { minimumFractionDigits: 0 })}</td>
                                                    </Fragment>
                                                ))}
                                                <td className="db-num" style={{ fontWeight: '700' }}>
                                                    {row.totalQty.toLocaleString()}
                                                </td>
                                                <td className="db-num" style={{ fontWeight: '700' }}>
                                                    ₱{row.totalSales.toLocaleString(undefined, { minimumFractionDigits: 0 })}
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {allSalesData.length > 0 && pagination.totalPages > 1 && (
                            <div className="db-pagination">
                                <span className="db-page-info">
                                    Showing <strong>{((currentPage - 1) * pageSize) + 1}</strong> to <strong>{Math.min(currentPage * pageSize, pagination.totalItems)}</strong> of <strong>{pagination.totalItems}</strong> unique items
                                </span>
                                <div className="db-page-btns">
                                    <button 
                                        className="db-page-btn" 
                                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))} 
                                        disabled={currentPage === 1}
                                        title="Previous Page"
                                    >
                                        <IconChevronLeft />
                                    </button>
                                    
                                    <span className="db-page-dots" style={{ minWidth: '100px' }}>
                                        Page {currentPage} of {pagination.totalPages}
                                    </span>

                                    <button 
                                        className="db-page-btn" 
                                        onClick={() => setCurrentPage(p => Math.min(pagination.totalPages, p + 1))} 
                                        disabled={currentPage === pagination.totalPages}
                                        title="Next Page"
                                    >
                                        <IconChevronRight />
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </main>
        </div>
    );
}
