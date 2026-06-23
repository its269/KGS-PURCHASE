"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { DataCache } from "@/lib/data-cache";
import { fetchWithAuth } from "@/lib/api-client";
import "@/styles/dashboard.css";
import "@/styles/stock-items.css";
import "@/styles/inventory-detail.css";

const PAGE_SIZE = 50;

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

const LEAD_TIME_OPTIONS = [
    { label: "1-2 Weeks", value: "1-2w" },
    { label: "3-4 Weeks", value: "3-4w" },
    { label: "1-2 Months", value: "1-2m" },
    { label: "3-6 Months", value: "3-6m" },
    { label: "On Demand", value: "od" },
];

export default function SuppliersPage() {
    /* ── State ────────────────────────────────────────────── */
    const [vendors, setVendors] = useState([]);
    const [hasMore, setHasMore] = useState(false);
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [leadTimes, setLeadTimes] = useState({});
    const [showReliabilityInfo, setShowReliabilityInfo] = useState(false);

    const isInitialMount = useRef(true);
    const saveTimeoutRef = useRef({});

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
            const cached = DataCache.get(`vendors_${params.toString()}`);
            if (cached) {
                setVendors(cached.vendors ?? []);
                setHasMore(cached.hasMore ?? false);
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

    const fetchVendors = useCallback(async (isBackground = false) => {
        if (!isBackground) setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
            if (debouncedSearch) params.set("search", debouncedSearch);
            const cacheKey = `vendors_${params.toString()}`;

            const res = await fetchWithAuth(`/api/vendors?${params}`);
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.message || `HTTP ${res.status}`);
            }
            const data = await res.json();
            setVendors(data.vendors ?? []);
            setHasMore(data.hasMore ?? false);
            DataCache.set(cacheKey, data);
        } catch (err) {
            if (err.message === "Unauthorized") return;
            if (!isBackground) setError(err.message || "Failed to load suppliers. Please try again.");
        } finally {
            setLoading(false);
        }
    }, [page, debouncedSearch]);

    useEffect(() => {
        const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
        if (debouncedSearch) params.set("search", debouncedSearch);
        const cacheKey = `vendors_${params.toString()}`;

        const cached = DataCache.get(cacheKey);
        if (cached) {
            Promise.resolve().then(() => fetchVendors(true));
        } else {
            Promise.resolve().then(() => fetchVendors(false));
        }
    }, [fetchVendors, page, debouncedSearch]);

    const stats = useMemo(() => {
        const total = vendors.length;
        const withLeadTime = Object.keys(leadTimes).filter(id => vendors.some(v => v.vendorId === id)).length;
        return { total, withLeadTime };
    }, [vendors, leadTimes]);

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
                    <p>Manage your external suppliers and track average delivery lead times.</p>
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
                                    className="db-search-clear"
                                    onClick={() => setSearch("")}
                                    style={{ 
                                        position: 'absolute', 
                                        right: '1rem', 
                                        background: 'none', 
                                        border: 'none', 
                                        color: 'var(--text-muted)', 
                                        cursor: 'pointer',
                                        fontSize: '1.2rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        padding: '4px'
                                    }}
                                >
                                    &times;
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {error && <div className="si-error">{error}</div>}

                <div className="db-table-wrap" style={{ borderRadius: '16px', overflow: 'hidden', border: '1px solid var(--border-light)', boxShadow: 'var(--shadow-md)' }}>
                    <table className="db-table">
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
                                <tr key={v.vendorId} className="db-clickable-row">
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
                                            width: '50px', 
                                            height: '50px', 
                                            borderRadius: '50%', 
                                            border: `4px solid ${v.reliabilityScore >= 90 ? 'var(--status-success)' : v.reliabilityScore >= 80 ? 'var(--status-warning)' : 'var(--status-danger)'}`,
                                            fontWeight: '700',
                                            fontSize: '0.85rem',
                                            color: 'var(--text-primary)',
                                            background: 'var(--bg-surface)'
                                        }}>
                                            {Math.round(v.reliabilityScore)}%
                                        </div>
                                    </td>
                                    <td style={{ padding: '1.25rem' }}>
                                        <div className="db-select-wrapper" style={{ height: '40px', background: 'var(--bg-surface)' }}>
                                            <IconClock />
                                            <select
                                                className="db-select"
                                                value={leadTimes[v.vendorId] || ""}
                                                onChange={(e) => handleLeadTimeChange(v.vendorId, e.target.value)}
                                                style={{ border: 'none', background: 'transparent', width: '100%', cursor: 'pointer', fontSize: '0.85rem' }}
                                            >
                                                <option value="">— Target —</option>
                                                {LEAD_TIME_OPTIONS.map(opt => (
                                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                ))}
                                            </select>
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
                                The Reliability Score measures how consistently a supplier delivers orders on or before their promised date. It is expressed as a percentage to make it easy to compare vendors.
                            </p>

                            <div style={{ background: 'var(--bg-main)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-light)', marginBottom: '1.5rem' }}>
                                <h4 style={{ margin: '0 0 1rem 0', color: 'var(--text-primary)', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border-light)', paddingBottom: '0.5rem' }}>Core Performance Formulas</h4>
                                
                                <div style={{ marginBottom: '1.5rem' }}>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '600', marginBottom: '0.5rem' }}>1. Reliability Score (%)</div>
                                    <div style={{ fontSize: '1.1rem', fontWeight: '700', color: 'var(--accent-primary)', textAlign: 'center', padding: '0.75rem', background: 'var(--bg-surface)', borderRadius: '8px' }}>
                                        (On-Time Orders ÷ Total Orders) × 100
                                    </div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                                        *On-Time = Orders received on or before the Promised Date.
                                    </div>
                                </div>

                                <div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '600', marginBottom: '0.5rem' }}>2. Actual Avg. Lead Time (Days)</div>
                                    <div style={{ fontSize: '1.1rem', fontWeight: '700', color: 'var(--status-success)', textAlign: 'center', padding: '0.75rem', background: 'var(--bg-surface)', borderRadius: '8px' }}>
                                        Σ(Receipt Date - Order Date) ÷ Total Orders
                                    </div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                                        *Lead Time = The real number of days from PO creation to warehouse arrival.
                                    </div>
                                </div>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                <div style={{ display: 'flex', gap: '1rem' }}>
                                    <div style={{ color: 'var(--status-success)', fontWeight: '700' }}>●</div>
                                    <div>
                                        <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: '0.25rem' }}>Measurement Period</strong>
                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                                            Metrics are calculated using the last <strong>12 months</strong> of historical data to reflect recent supplier performance.
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
        </div>
    );
}
