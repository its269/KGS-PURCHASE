"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { DataCache } from "@/lib/data-cache";
import { loadListWithCache } from "@/lib/list-cache";
import { prefetchRemainingPages } from "@/lib/progressive-load";
import { fetchWithAuth } from "@/lib/api-client";
import "@/styles/dashboard.css";
import "@/styles/stock-items.css";
import "@/styles/inventory-detail.css";
import "@/styles/po.css";

const PAGE_SIZE = 10;

function formatReliabilityScore(score) {
    if (score == null || !Number.isFinite(Number(score))) return "N/A";
    return `${Number(score).toFixed(2)}%`;
}

function reliabilityBorderColor(score) {
    if (score == null || !Number.isFinite(Number(score))) return "var(--border-light)";
    const n = Number(score);
    if (n >= 90) return "var(--status-success)";
    if (n >= 80) return "var(--status-warning)";
    return "var(--status-danger)";
}

/* ── SVG Icons ─────────────────────────────────────────── */
const IconSearch = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
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
const IconTruck = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 17h4V5H2v12h3" /><path d="M20 17h2v-3.34a4 4 0 0 0-1.17-2.83L17 7h-3v10" /><circle cx="7.5" cy="17.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" />
    </svg>
);
const IconClock = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
);
const IconInfo = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
);
const IconClose = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
);

function fmtAmount(n) {
    return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtOrderDate(d) {
    if (!d) return "—";
    const date = new Date(d);
    if (isNaN(date.getTime())) return d;
    return date.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}

function poStatusClass(status) {
    const s = (status || "").toLowerCase();
    if (s === "open") return "po-status-open";
    if (s === "closed") return "po-status-closed";
    if (s === "completed") return "po-status-completed";
    if (s === "cancelled" || s === "canceled") return "po-status-cancelled";
    return "po-status-default";
}

export default function SuppliersPage() {
    /* ── State ────────────────────────────────────────────── */
    const [vendors, setVendors] = useState([]);
    const [hasMore, setHasMore] = useState(false);
    const [totalCount, setTotalCount] = useState(0);
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [loading, setLoading] = useState(true);
    const [backgroundLoading, setBackgroundLoading] = useState(false);
    const [error, setError] = useState(null);
    const [leadTimes, setLeadTimes] = useState({});
    const [showReliabilityInfo, setShowReliabilityInfo] = useState(false);
    const [selectedVendor, setSelectedVendor] = useState(null);
    const [supplierOrders, setSupplierOrders] = useState([]);
    const [ordersLoading, setOrdersLoading] = useState(false);
    const [ordersError, setOrdersError] = useState(null);

    const isInitialMount = useRef(true);
    const prefetchAbortRef = useRef(null);
    const saveTimeoutRef = useRef({});

    const vendorParamsFor = useCallback((pageNum) => {
        const params = new URLSearchParams({ page: String(pageNum), pageSize: String(PAGE_SIZE) });
        if (debouncedSearch) params.set("search", debouncedSearch);
        return params;
    }, [debouncedSearch]);

    const vendorCacheKeyFor = useCallback((pageNum) => {
        return `vendors_v2_${vendorParamsFor(pageNum).toString()}`;
    }, [vendorParamsFor]);

    // Initial restoration & Hydration fix
    useEffect(() => {
        const savedPage = localStorage.getItem("supplier_filter_page");
        const initialPage = savedPage ? parseInt(savedPage) : 1;
        const savedSearch = localStorage.getItem("supplier_filter_search") || "";

        Promise.resolve().then(async () => {
            // 1. Load filters
            setPage(initialPage);
            setSearch(savedSearch);

            // 2. Fetch PERSISTENT lead times from DB
            try {
                const res = await fetchWithAuth("/api/annotations?module=supplier");
                if (res.ok) {
                    const dbLeadTimes = await res.json();
                    // Transform { [vendorId]: { leadTime: value } } to { [vendorId]: value }
                    const flattened = Object.keys(dbLeadTimes).reduce((acc, vid) => {
                        acc[vid] = dbLeadTimes[vid].leadTime;
                        return acc;
                    }, {});
                    setLeadTimes(prev => ({ ...prev, ...flattened }));
                } else {
                    const savedLeadTimes = localStorage.getItem("supplier_lead_times");
                    if (savedLeadTimes) setLeadTimes(JSON.parse(savedLeadTimes));
                }
            } catch (e) {
                console.error("Failed to fetch lead times", e);
                const savedLeadTimes = localStorage.getItem("supplier_lead_times");
                if (savedLeadTimes) setLeadTimes(JSON.parse(savedLeadTimes));
            }

            const params = new URLSearchParams({ page: String(initialPage), pageSize: String(PAGE_SIZE) });
            if (savedSearch) params.set("search", savedSearch);
            const cached = DataCache.get(`vendors_v2_${params.toString()}`);
            if (cached) {
                setVendors(cached.vendors ?? []);
                setHasMore(cached.hasMore ?? false);
                setTotalCount(cached.totalCount ?? 0);
            }
            
            isInitialMount.current = false;
        });
    }, []);

    // Save lead times to localStorage (Backup)
    useEffect(() => {
        if (!isInitialMount.current && Object.keys(leadTimes).length > 0) {
            localStorage.setItem("supplier_lead_times", JSON.stringify(leadTimes));
        }
    }, [leadTimes]);

    const handleLeadTimeChange = (vendorId, value) => {
        // 1. UI update
        setLeadTimes(prev => ({ ...prev, [vendorId]: value }));

        // 2. Persist to DB (Debounced)
        if (saveTimeoutRef.current[vendorId]) {
            clearTimeout(saveTimeoutRef.current[vendorId]);
        }

        saveTimeoutRef.current[vendorId] = setTimeout(async () => {
            try {
                await fetchWithAuth("/api/annotations", {
                    method: "POST",
                    body: JSON.stringify({
                        module: "supplier",
                        refId: vendorId,
                        fieldKey: "leadTime",
                        fieldValue: value
                    })
                });
            } catch (e) {
                console.error("Failed to persist lead time", e);
            }
        }, 800);
    };

    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(search), 150);
        return () => clearTimeout(t);
    }, [search]);

    useEffect(() => {
        Promise.resolve().then(() => setPage(1));
    }, [debouncedSearch]);

    const fetchVendors = useCallback(async (pageNum = page, { background = false } = {}) => {
        if (!background) setLoading(true);
        if (!background) setError(null);
        try {
            const params = vendorParamsFor(pageNum);
            const cacheKey = vendorCacheKeyFor(pageNum);

            const res = await fetchWithAuth(`/api/vendors?${params}`);
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.message || `HTTP ${res.status}`);
            }
            const data = await res.json();
            if (!background || pageNum === page) {
                setVendors(data.vendors ?? []);
                setHasMore(data.hasMore ?? false);
                setTotalCount(data.totalCount ?? 0);
            }
            DataCache.set(cacheKey, data, { persist: false });

            if (pageNum === 1 && !background) {
                prefetchAbortRef.current?.();
                const total = data.totalCount ?? 0;
                if (total > PAGE_SIZE) {
                    setBackgroundLoading(true);
                    prefetchAbortRef.current = prefetchRemainingPages({
                        pageSize: PAGE_SIZE,
                        totalCount: total,
                        cacheKeyForPage: vendorCacheKeyFor,
                        fetchPage: (p) => fetchVendors(p, { background: true }),
                        onComplete: () => setBackgroundLoading(false),
                    });
                }
            }
        } catch (err) {
            if (err.message === "Unauthorized") return;
            if (!background) setError(err.message || "Failed to load suppliers. Please try again.");
        } finally {
            if (!background) setLoading(false);
        }
    }, [page, vendorParamsFor, vendorCacheKeyFor]);

    useEffect(() => {
        prefetchAbortRef.current?.();
        const cacheKey = vendorCacheKeyFor(page);

        const cached = DataCache.get(cacheKey);
        loadListWithCache({
            cacheKey,
            cached,
            apply: (data) => {
                setVendors(data.vendors ?? []);
                setHasMore(data.hasMore ?? false);
                setTotalCount(data.totalCount ?? 0);
            },
            setLoading,
            refetch: () => fetchVendors(page, { background: false }),
        });

        if (page === 1 && cached?.totalCount > PAGE_SIZE) {
            setBackgroundLoading(true);
            prefetchAbortRef.current = prefetchRemainingPages({
                pageSize: PAGE_SIZE,
                totalCount: cached.totalCount,
                cacheKeyForPage: vendorCacheKeyFor,
                fetchPage: (p) => fetchVendors(p, { background: true }),
                onComplete: () => setBackgroundLoading(false),
            });
        }
    }, [fetchVendors, page, debouncedSearch, vendorCacheKeyFor]);

    const stats = useMemo(() => {
        const total = vendors.length;
        const withLeadTime = Object.keys(leadTimes).filter(id => vendors.some(v => v.vendorId === id)).length;
        return { total, withLeadTime };
    }, [vendors, leadTimes]);

    const openSupplierOrders = useCallback(async (vendor) => {
        setSelectedVendor(vendor);
        setSupplierOrders([]);
        setOrdersError(null);
        setOrdersLoading(true);

        try {
            const params = new URLSearchParams({
                page: "1",
                pageSize: "50",
                vendorId: vendor.vendorId,
                status: "",
            });
            const res = await fetchWithAuth(`/api/po?${params}`);
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.message || `HTTP ${res.status}`);
            }
            const data = await res.json();
            setSupplierOrders(data.orders ?? []);
        } catch (err) {
            if (err.message !== "Unauthorized") {
                setOrdersError(err.message || "Failed to load purchase orders for this supplier.");
            }
        } finally {
            setOrdersLoading(false);
        }
    }, []);

    const closeSupplierOrders = () => {
        setSelectedVendor(null);
        setSupplierOrders([]);
        setOrdersError(null);
    };

    return (
        <div className="db-root">
            <main className="db-main">
                <div className="db-page-title">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem' }}>
                        <div style={{ background: 'rgba(59, 130, 246, 0.1)', color: 'var(--accent-primary)', padding: '0.75rem', borderRadius: '12px' }}>
                            <IconTruck />
                        </div>
                        <h1 style={{ margin: 0 }}>Suppliers Directory</h1>
                    </div>
                    <p>Manage your external suppliers and track average delivery lead times. Click a supplier row to view their purchase orders.</p>
                </div>

                <div className="db-stats" style={{ marginBottom: '2rem' }}>
                    <div className="db-stat-card db-stat-blue">
                        <span className="db-stat-label">Total Suppliers</span>
                        <span className="db-stat-value">{loading && vendors.length === 0 ? "..." : vendors.length}</span>
                        <span className="db-stat-sub">Active Vendors in ERP</span>
                    </div>
                    <div className="db-stat-card">
                        <span className="db-stat-label">Tracked Lead Times</span>
                        <span className="db-stat-value">{stats.withLeadTime}</span>
                        <span className="db-stat-sub">Suppliers with user input</span>
                    </div>
                </div>

                <div className="db-toolbar" style={{ borderRadius: '16px', padding: '1.25rem' }}>
                    <div className="db-toolbar-left" style={{ flex: 1 }}>
                        <div className="db-search-wrapper" style={{ width: '100%', maxWidth: '500px' }}>
                            <IconSearch />
                            <input
                                className="db-search"
                                type="text"
                                placeholder="Search by Supplier ID or Name..."
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                style={{ height: '42px' }}
                            />
                            {search && (
                                <button
                                    type="button"
                                    className="db-search-clear"
                                    onClick={() => setSearch("")}
                                    aria-label="Clear search"
                                >
                                    ×
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {error && <div className="si-error">{error}</div>}

                <div className="db-table-wrap" style={{ borderRadius: '16px', overflow: 'hidden', border: '1px solid var(--border-light)', boxShadow: 'var(--shadow-md)' }}>
                    <table className="db-table db-table--fit">
                        <thead style={{ background: 'var(--bg-main)' }}>
                            <tr>
                                <th style={{ width: '200px', padding: '1.25rem' }}>Supplier ID</th>
                                <th style={{ padding: '1.25rem' }}>Supplier Name</th>
                                <th style={{ width: '180px', padding: '1.25rem', textAlign: 'center' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                                        Reliability Score
                                        <button 
                                            onClick={() => setShowReliabilityInfo(true)}
                                            style={{ 
                                                background: 'none', 
                                                border: 'none', 
                                                color: 'var(--accent-primary)', 
                                                cursor: 'pointer', 
                                                padding: '2px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                borderRadius: '50%',
                                                transition: 'background 0.2s'
                                            }}
                                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)'}
                                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                                            title="How is this calculated?"
                                        >
                                            <IconInfo />
                                        </button>
                                    </div>
                                </th>
                                <th style={{ width: '220px', padding: '1.25rem' }}>Avg. Lead Time</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && vendors.length === 0 ? (
                                <tr><td colSpan={4} className="si-loading-cell">
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', padding: '4rem' }}>
                                        <div className="db-spinner db-spinner-lg"></div>
                                        <span style={{ color: 'var(--text-secondary)', fontWeight: '500' }}>Fetching suppliers from Acumatica...</span>
                                    </div>
                                </td></tr>
                            ) : vendors.length === 0 ? (
                                <tr><td colSpan={4} className="si-empty-cell" style={{ padding: '4rem' }}>No suppliers found matching your criteria.</td></tr>
                            ) : vendors.map(v => (
                                <tr
                                    key={v.vendorId}
                                    className={`db-clickable-row ${selectedVendor?.vendorId === v.vendorId ? "si-row-selected" : ""}`}
                                    onClick={() => openSupplierOrders(v)}
                                >
                                    <td style={{ padding: '1.25rem' }}>
                                        <span className="db-inv-id" style={{ background: 'var(--bg-main)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)' }}>{v.vendorId}</span>
                                    </td>
                                    <td style={{ padding: '1.25rem' }}>
                                        <div style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: '0.95rem' }}>{v.vendorName}</div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{v.status}</div>
                                    </td>
                                    <td style={{ padding: '1.25rem', textAlign: 'center' }}>
                                        <div style={{ 
                                            display: 'inline-flex', 
                                            alignItems: 'center', 
                                            justifyContent: 'center',
                                            minWidth: '64px', 
                                            height: '64px', 
                                            padding: '0 8px',
                                            borderRadius: '50%', 
                                            border: `4px solid ${reliabilityBorderColor(v.reliabilityScore)}`,
                                            fontWeight: '700',
                                            fontSize: '0.7rem',
                                            color: 'var(--text-primary)',
                                            background: 'var(--bg-surface)'
                                        }}>
                                            {formatReliabilityScore(v.reliabilityScore)}
                                        </div>
                                        {v.totalOrders > 0 && (
                                            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.4rem', fontWeight: '600' }}>
                                                {v.onTimeOrders}/{v.totalOrders} on-time
                                            </div>
                                        )}
                                    </td>
                                    <td style={{ padding: '1.25rem' }} onClick={(e) => e.stopPropagation()}>
                                        <div className="sup-lead-time-input">
                                            <IconClock />
                                            <input
                                                type="number"
                                                className="sup-lead-time-field"
                                                min="0"
                                                step="1"
                                                placeholder="Days"
                                                value={leadTimes[v.vendorId] ?? ""}
                                                onChange={(e) => handleLeadTimeChange(v.vendorId, e.target.value)}
                                            />
                                            <span className="sup-lead-time-suffix">days</span>
                                        </div>
                                        {v.avgLeadTime > 0 && (
                                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.4rem', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <span style={{ color: 'var(--accent-primary)' }}>●</span> Actual: {v.avgLeadTime} days
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {backgroundLoading && (
                    <div className="db-bg-loading">
                        <div className="db-spinner" />
                        Loading remaining rows in the background…
                    </div>
                )}

                {!loading && (
                    <div className="db-pagination" style={{ marginTop: '2rem' }}>
                        <span className="db-page-info">Page <strong>{page}</strong></span>
                        <div className="db-page-btns">
                            <button className="db-page-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                                <IconChevronLeft />
                            </button>
                            <span className="db-page-dots">Page {page}</span>
                            <button className="db-page-btn" onClick={() => setPage(p => p + 1)} disabled={!hasMore}>
                                <IconChevronRight />
                            </button>
                        </div>
                    </div>
                )}
            </main>

            {/* ── Reliability Info Lightbox ── */}
            {showReliabilityInfo && (
                <div className="idm-overlay" onClick={() => setShowReliabilityInfo(false)} style={{ zIndex: 1000 }}>
                    <div className="idm-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
                        <button className="idm-close-btn" onClick={() => setShowReliabilityInfo(false)}>
                            <IconClose />
                        </button>
                        
                        <div className="idm-content" style={{ padding: '2rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                                <div style={{ background: 'rgba(59, 130, 246, 0.1)', color: 'var(--accent-primary)', padding: '0.75rem', borderRadius: '12px' }}>
                                    <IconInfo />
                                </div>
                                <h2 style={{ margin: 0, fontSize: '1.5rem', color: 'var(--text-primary)' }}>Reliability Score</h2>
                            </div>

                            <p style={{ color: 'var(--text-secondary)', lineHeight: '1.6', marginBottom: '1.5rem' }}>
                                The Reliability Score measures how consistently a supplier delivers closed purchase orders on or before the promised date. Scores are calculated live from synced PO history and shown to two decimal places (for example, <strong>11.51%</strong>).
                            </p>

                            <div style={{ background: 'var(--bg-main)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-light)', marginBottom: '1.5rem' }}>
                                <h4 style={{ margin: '0 0 1rem 0', color: 'var(--text-primary)', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border-light)', paddingBottom: '0.5rem' }}>Core Performance Formulas</h4>
                                
                                <div style={{ marginBottom: '1.5rem' }}>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '600', marginBottom: '0.5rem' }}>1. Reliability Score (%)</div>
                                    <div style={{ fontSize: '1.1rem', fontWeight: '700', color: 'var(--accent-primary)', textAlign: 'center', padding: '0.75rem', background: 'var(--bg-surface)', borderRadius: '8px' }}>
                                        (On-Time Orders ÷ Total Orders) × 100
                                    </div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                                        *On-Time = Receipt date on or before the promised date.<br />
                                        *Only <strong>Closed</strong> or <strong>Completed</strong> POs with both promised and receipt dates are included.<br />
                                        *Suppliers with no qualifying orders in the last 12 months show <strong>N/A</strong>.
                                    </div>
                                </div>

                                <div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '600', marginBottom: '0.5rem' }}>2. Actual Avg. Lead Time (Days)</div>
                                    <div style={{ fontSize: '1.1rem', fontWeight: '700', color: 'var(--status-success)', textAlign: 'center', padding: '0.75rem', background: 'var(--bg-surface)', borderRadius: '8px' }}>
                                        Σ(Receipt Date - Order Date) ÷ Total Orders
                                    </div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                                        *Lead Time = Days from PO creation to warehouse receipt.<br />
                                        *Uses the last <strong>12 months</strong> of closed PO history.<br />
                                        *Shown below the lead-time input when historical data exists.
                                    </div>
                                </div>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                <div style={{ display: 'flex', gap: '1rem' }}>
                                    <div style={{ color: 'var(--status-success)', fontWeight: '700' }}>●</div>
                                    <div>
                                        <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: '0.25rem' }}>Measurement Period</strong>
                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                                            Reliability scores use the last <strong>12 months</strong> of closed PO history. Each score also shows the underlying count (for example, <strong>61/530 on-time</strong>).
                                        </span>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '1rem' }}>
                                    <div style={{ color: 'var(--accent-primary)', fontWeight: '700' }}>●</div>
                                    <div>
                                        <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: '0.25rem' }}>Data Source</strong>
                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                                            Values come from purchase orders synced from Acumatica during Data Synchronization — not static placeholders.
                                        </span>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '1rem' }}>
                                    <div style={{ color: 'var(--accent-primary)', fontWeight: '700' }}>●</div>
                                    <div>
                                        <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: '0.25rem' }}>Why it matters</strong>
                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>These formulas help identify which suppliers consistently meet deadlines versus those who frequently cause stockouts due to delays.</span>
                                    </div>
                                </div>
                            </div>

                            <button 
                                onClick={() => setShowReliabilityInfo(false)}
                                style={{ 
                                    width: '100%', 
                                    marginTop: '2rem', 
                                    padding: '0.75rem', 
                                    background: 'var(--text-primary)', 
                                    color: 'var(--text-inverse)', 
                                    border: 'none', 
                                    borderRadius: '8px', 
                                    fontWeight: '600', 
                                    cursor: 'pointer' 
                                }}
                            >
                                Got it
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Supplier Orders Lightbox ── */}
            {selectedVendor && (
                <div className="idm-overlay" onClick={closeSupplierOrders} style={{ zIndex: 1000 }}>
                    <div className="idm-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "900px", width: "95vw" }}>
                        <button className="idm-close-btn" onClick={closeSupplierOrders} aria-label="Close">
                            <IconClose />
                        </button>

                        <div className="idm-content" style={{ padding: "2rem" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.25rem" }}>
                                <div style={{ background: "rgba(59, 130, 246, 0.1)", color: "var(--accent-primary)", padding: "0.75rem", borderRadius: "12px" }}>
                                    <IconTruck />
                                </div>
                                <div>
                                    <h2 style={{ margin: 0, fontSize: "1.35rem", color: "var(--text-primary)" }}>
                                        {selectedVendor.vendorName}
                                    </h2>
                                    <p style={{ margin: "0.25rem 0 0", color: "var(--text-muted)", fontSize: "0.85rem" }}>
                                        Supplier ID: <strong>{selectedVendor.vendorId}</strong>
                                        {selectedVendor.reliabilityScore != null && (
                                            <> · Reliability: <strong>{formatReliabilityScore(selectedVendor.reliabilityScore)}</strong></>
                                        )}
                                    </p>
                                </div>
                            </div>

                            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginBottom: "1rem" }}>
                                Purchase orders linked to this supplier only.
                            </p>

                            {ordersLoading ? (
                                <div style={{ padding: "3rem", textAlign: "center" }}>
                                    <div className="db-spinner" style={{ margin: "0 auto 1rem" }} />
                                    <p style={{ fontWeight: 600, color: "var(--text-secondary)" }}>Loading orders...</p>
                                </div>
                            ) : ordersError ? (
                                <div style={{ padding: "2rem", textAlign: "center", color: "var(--status-danger)" }}>{ordersError}</div>
                            ) : supplierOrders.length === 0 ? (
                                <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>
                                    No purchase orders found for this supplier.
                                </div>
                            ) : (
                                <div className="db-table-wrap" style={{ maxHeight: "420px", overflow: "auto" }}>
                                    <table className="db-table" style={{ fontSize: "0.82rem" }}>
                                        <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
                                            <tr>
                                                <th>Order #</th>
                                                <th>Status</th>
                                                <th>Order Date</th>
                                                <th style={{ textAlign: "right" }}>Total Amount</th>
                                                <th style={{ textAlign: "right" }}>Line Items</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {supplierOrders.map((order) => (
                                                <tr key={`${order.orderType || "PO"}-${order.orderNbr}`}>
                                                    <td><span className="db-inv-id">{order.orderNbr}</span></td>
                                                    <td>
                                                        <span className={`db-badge ${poStatusClass(order.status)}`}>
                                                            {order.status || "—"}
                                                        </span>
                                                    </td>
                                                    <td>{fmtOrderDate(order.date)}</td>
                                                    <td style={{ textAlign: "right", fontWeight: 700 }}>
                                                        ₱{fmtAmount(order.totalAmount)}
                                                    </td>
                                                    <td style={{ textAlign: "right" }}>
                                                        {order.lines?.length ?? 0}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            <button
                                onClick={closeSupplierOrders}
                                style={{
                                    width: "100%",
                                    marginTop: "1.5rem",
                                    padding: "0.75rem",
                                    background: "var(--text-primary)",
                                    color: "var(--text-inverse)",
                                    border: "none",
                                    borderRadius: "8px",
                                    fontWeight: 600,
                                    cursor: "pointer",
                                }}
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
