"use client";

import { Fragment, useState, useEffect, useCallback, useRef, useMemo } from "react";
import { DataCache } from "@/lib/data-cache";
import { fetchWithAuth } from "@/lib/api-client";
import { withBasePath } from "@/lib/base-path";
import InventoryDetailModal from "@/components/InventoryDetailModal";
import "@/styles/dashboard.css";
import "@/styles/stock-items.css";
import "@/styles/po.css";

const PAGE_SIZE = 50;

function isPoCacheUsable(cached) {
    if (!cached?.orders?.length) return false;
    return cached.orders.some(o => o.lines?.length);
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
const IconChevronDown = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9" />
    </svg>
);
const IconCalendar = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
);
const IconInfo = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
);
const IconActivity = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
);
const IconDownload = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
    </svg>
);
const IconChevronSelect = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9" />
    </svg>
);

function poStatusClass(status) {
    const s = (status || "").toLowerCase();
    if (s === "open") return "po-status-open";
    if (s === "closed") return "po-status-closed";
    if (s === "completed") return "po-status-completed";
    if (s === "cancelled" || s === "canceled") return "po-status-cancelled";
    return "po-status-default";
}

function fmt(n) { return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtDate(d) {
    if (!d) return "—";
    const date = new Date(d);
    if (isNaN(date.getTime())) return d;
    return date.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}

export default function PurchaseOrdersPage() {
    const [orders, setOrders] = useState([]);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(false);
    const [search, setSearch] = useState("");
    const [debSearch, setDebSearch] = useState("");
    const [startDate, setStartDate] = useState("");
    const [status, setStatus] = useState("Open");
    const [selectedBranch, setSelectedBranch] = useState("");
    const [branchOptions, setBranchOptions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [expanded, setExpanded] = useState({}); // orderNbr -> bool
    const [selectedId, setSelectedId] = useState(null);
    const [userInputs, setUserInputs] = useState({}); // key -> { eta, userStatus }
    const [exporting, setExporting] = useState(false);

    const handleExport = async () => {
        setExporting(true);
        try {
            window.location.href = withBasePath("/api/export?type=po");
        } catch (e) {
            console.error("Export failed", e);
        } finally {
            setTimeout(() => setExporting(false), 2000);
        }
    };

    const isInitialMount = useRef(true);
    const saveTimeoutRef = useRef({}); // key -> timeout

    // Initial restoration & Hydration fix
    useEffect(() => {
        const savedPage = localStorage.getItem("po_filter_page");
        const savedSearch = localStorage.getItem("po_filter_search");
        const savedStart = localStorage.getItem("po_filter_startDate");
        const savedStatus = localStorage.getItem("po_filter_status");
        const savedBranch = localStorage.getItem("po_filter_branch") || "";

        Promise.resolve().then(async () => {
            // 1. Load filters
            if (savedPage) setPage(parseInt(savedPage));
            if (savedSearch) setSearch(savedSearch);
            if (savedStart) setStartDate(savedStart);
            if (savedStatus) setStatus(savedStatus);
            if (savedBranch) setSelectedBranch(savedBranch);

            // 2. Fetch PERSISTENT annotations from DB
            try {
                const res = await fetchWithAuth("/api/annotations?module=po");
                if (res.ok) {
                    const dbInputs = await res.json();
                    setUserInputs(prev => ({ ...prev, ...dbInputs }));
                } else {
                    // Fallback to local if DB fails
                    const savedInputs = localStorage.getItem("po_user_inputs");
                    if (savedInputs) setUserInputs(JSON.parse(savedInputs));
                }
            } catch (e) {
                console.error("Failed to fetch annotations", e);
                const savedInputs = localStorage.getItem("po_user_inputs");
                if (savedInputs) setUserInputs(JSON.parse(savedInputs));
            }

            // 3. Pre-fetch check from cache
            const params = new URLSearchParams({
                page: savedPage || "1",
                pageSize: String(PAGE_SIZE),
                startDate: savedStart || "",
                status: savedStatus || "Open"
            });
            if (savedSearch) params.set("search", savedSearch);
            if (savedBranch) params.set("branch", savedBranch);
            const cacheKey = `po_orders_${params.toString()}`;
            const cached = DataCache.get(cacheKey);
            if (cached && isPoCacheUsable(cached)) {
                setOrders(cached.orders ?? []);
                setHasMore(cached.hasMore ?? false);
            }
            isInitialMount.current = false;
        });
    }, []);

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const res = await fetchWithAuth("/api/branches?source=mysql");
                if (res.ok && active) {
                    const branches = await res.json();
                    const options = branches.map((b) => ({
                        id: b.SiteID || b.branch_id || "",
                        name: b.Description?.value || b.branch_name || b.SiteID || "",
                    })).filter((b) => b.id);
                    setBranchOptions(options);
                }
            } catch (err) {
                console.error("Failed to load branches", err);
            }
        })();
        return () => { active = false; };
    }, []);

    // Backup to localStorage just in case
    useEffect(() => {
        if (!isInitialMount.current) {
            localStorage.setItem("po_user_inputs", JSON.stringify(userInputs));
        }
    }, [userInputs]);

    const handleUserInput = (key, field, value) => {
        // 1. Update UI immediately
        setUserInputs(prev => ({
            ...prev,
            [key]: { ...(prev[key] || {}), [field]: value }
        }));

        // 2. Persist to DB (Debounced)
        if (saveTimeoutRef.current[key + field]) {
            clearTimeout(saveTimeoutRef.current[key + field]);
        }

        saveTimeoutRef.current[key + field] = setTimeout(async () => {
            try {
                await fetchWithAuth("/api/annotations", {
                    method: "POST",
                    body: JSON.stringify({
                        module: "po",
                        refId: key,
                        fieldKey: field,
                        fieldValue: value
                    })
                });
            } catch (e) {
                console.error("Failed to persist annotation", e);
            }
        }, 800);
    };

    // Save filters to localStorage
    useEffect(() => {
        if (!isInitialMount.current) {
            localStorage.setItem("po_filter_page", page.toString());
            localStorage.setItem("po_filter_search", search);
            localStorage.setItem("po_filter_startDate", startDate);
            localStorage.setItem("po_filter_status", status);
            localStorage.setItem("po_filter_branch", selectedBranch);
        }
    }, [page, search, startDate, status, selectedBranch]);

    useEffect(() => {
        const t = setTimeout(() => setDebSearch(search), 350);
        return () => clearTimeout(t);
    }, [search]);

    useEffect(() => {
        if (isInitialMount.current) {
            isInitialMount.current = false;
            return;
        }
        setPage(1);
    }, [debSearch, startDate, status, selectedBranch]);

    const fetchOrders = useCallback(async (isBackground = false) => {
        if (!isBackground) setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({
                page: String(page),
                pageSize: String(PAGE_SIZE),
                startDate: startDate,
                status: status
            });
            if (debSearch) params.set("search", debSearch);
            if (selectedBranch) params.set("branch", selectedBranch);
            const cacheKey = `po_orders_${params.toString()}`;

            const res = await fetchWithAuth(`/api/po?${params}`); 
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.message || `HTTP ${res.status}`);
            }
            const data = await res.json();
            setOrders(data.orders ?? []);
            setHasMore(data.hasMore ?? false);
            DataCache.set(cacheKey, data);
        } catch (err) {
            if (err.message === "Unauthorized") return;
            if (!isBackground) setError(err.message || "Failed to load purchase orders.");
        } finally {
            setLoading(false);
        }
    }, [page, debSearch, startDate, status, selectedBranch]);

    useEffect(() => {
        const params = new URLSearchParams({
            page: String(page),
            pageSize: String(PAGE_SIZE),
            startDate: startDate,
            status: status
        });
        if (debSearch) params.set("search", debSearch);
        if (selectedBranch) params.set("branch", selectedBranch);
        const cacheKey = `po_orders_${params.toString()}`;

        const cached = DataCache.get(cacheKey);
        if (cached && isPoCacheUsable(cached)) {
            setTimeout(() => {
                setOrders(cached.orders ?? []);
                setHasMore(cached.hasMore ?? false);
                setLoading(false);
                fetchOrders(true);
            }, 0);
        } else {
            if (cached) DataCache.delete(cacheKey);
            setTimeout(() => fetchOrders(false), 0);
        }
    }, [fetchOrders, page, debSearch, startDate, status, selectedBranch]);

    const toggleExpand = (key) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

    const summaryStats = useMemo(() => {
        const totalValue = orders.reduce((sum, o) => sum + (Number(o.totalAmount) || 0), 0);
        const pendingEtaCount = orders.filter(o => !userInputs[`${o.orderType}-${o.orderNbr}`]?.eta).length;
        const openCount = orders.filter(o => o.status === 'Open').length;
        return { totalValue, pendingEtaCount, openCount };
    }, [orders, userInputs]);

    return (
        <div className="po-root">
            <main className="po-main">
                <div className="db-page-title">
                    <h1>Purchase Orders</h1>
                    <p>View and manage all purchase orders live from Acumatica ERP.</p>
                </div>

                <div className="po-toolbar">
                    <div className="po-filter-group">
                        <span className="po-filter-label">From:</span>
                        <input
                            type="date"
                            className="po-select-box"
                            style={{ width: '150px' }}
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                        />
                    </div>

                    <div className="po-filter-group">
                        <span className="po-filter-label">Status:</span>
                        <select
                            className="po-select-box"
                            style={{ width: '160px' }}
                            value={status}
                            onChange={(e) => setStatus(e.target.value)}
                        >
                            <option value="">All Statuses</option>
                            <option value="Hold">Hold</option>
                            <option value="Open">Open</option>
                            <option value="Balanced">Balanced</option>
                            <option value="Pending Approval">Pending Approval</option>
                            <option value="Completed">Completed</option>
                            <option value="Cancelled">Cancelled</option>
                            <option value="Closed">Closed</option>
                        </select>
                    </div>

                    <div className="po-filter-group">
                        <span className="po-filter-label">Branch:</span>
                        <div className="db-select-wrapper">
                            <select
                                className="po-select-box"
                                style={{ width: '180px' }}
                                value={selectedBranch}
                                onChange={(e) => setSelectedBranch(e.target.value)}
                            >
                                <option value="">All Branches</option>
                                <option value="MAIN">MAIN</option>
                                {branchOptions.filter((b) => b.id !== "MAIN").map((b) => (
                                    <option key={b.id} value={b.id}>{b.name || b.id}</option>
                                ))}
                            </select>
                            <IconChevronSelect />
                        </div>
                    </div>

                    <div className="db-search-wrapper po-search-container">
                        <IconSearch />
                        <input
                            className="db-search"
                            type="text"
                            placeholder="Search Order #, Vendor, or Item..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                        {search && (
                            <button 
                                className="db-search-clear"
                                onClick={() => setSearch("")}
                            >
                                &times;
                            </button>
                        )}
                    </div>

                    <button 
                        className="db-action-btn db-action-sync" 
                        onClick={handleExport}
                        disabled={exporting}
                    >
                        <IconDownload /> {exporting ? "..." : "Export"}
                    </button>
                </div>

                {error && <div className="si-error">{error}</div>}

                <div className="db-table-wrap">
                    <table className="db-table po-table">
                        <thead>
                            <tr>
                                <th style={{ width: 48 }}></th>
                                <th style={{ width: 140 }}>Order #</th>
                                <th style={{ width: 120 }}>Vendor ID</th>
                                <th>Vendor Name</th>
                                <th style={{ width: 140 }}>Status</th>
                                <th>Order Date</th>
                                <th style={{ width: 160 }}>ETA (Input)</th>
                                <th style={{ width: 140 }}>ETD</th>
                                <th style={{ width: 150 }}>Container Number</th>
                                <th style={{ width: 180 }}>Remarks</th>
                                <th style={{ width: 160 }}>User Status</th>
                                <th style={{ textAlign: "right", width: 160 }}>Total Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && orders.length === 0 ? (
                                <tr><td colSpan={12} className="si-loading-cell">
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', padding: '4rem 0' }}>
                                        <div className="db-spinner db-spinner-lg"></div>
                                        <span style={{ fontWeight: '600', color: 'var(--text-secondary)' }}>Fetching orders...</span>
                                    </div>
                                </td></tr>
                            ) : orders.length === 0 ? (
                                <tr><td colSpan={12} className="si-empty-cell" style={{ padding: '4rem 0' }}>No purchase orders found.</td></tr>
                            ) : orders.map(po => {
                                const key = `${po.orderType}-${po.orderNbr}`;
                                const isOpen = !!expanded[key];
                                const ui = userInputs[key] || {};
                                return (
                                    <Fragment key={key}>
                                        <tr className={`db-clickable-row ${isOpen ? "po-row-expanded" : ""}`} onClick={() => toggleExpand(key)}>
                                            <td>
                                                <span className={`po-expand-icon ${isOpen ? "po-expand-open" : ""}`}>
                                                    <IconChevronDown />
                                                </span>
                                            </td>
                                            <td><span className="db-inv-id">{po.orderNbr}</span></td>
                                            <td><span className="po-vendor-id">{po.vendorId || "—"}</span></td>
                                            <td>
                                                <span className="po-vendor-name">{po.vendorName || "—"}</span>
                                            </td>
                                            <td>
                                                <span className={`db-badge ${poStatusClass(po.status)}`}>{po.status || "—"}</span>
                                            </td>
                                            <td><span style={{ fontSize: '0.85rem', fontWeight: '500', color: 'var(--text-secondary)' }}>{fmtDate(po.date)}</span></td>
                                            <td onClick={(e) => e.stopPropagation()}>
                                                <input 
                                                    type="date" 
                                                    className="po-input-date" 
                                                    style={{ width: '100%' }}
                                                    value={ui.eta || ""}
                                                    onChange={(e) => handleUserInput(key, 'eta', e.target.value)}
                                                />
                                            </td>
                                            <td onClick={(e) => e.stopPropagation()}>
                                                <input
                                                    type="date"
                                                    className="po-input-date"
                                                    style={{ width: '100%' }}
                                                    value={ui.etd || ""}
                                                    onChange={(e) => handleUserInput(key, 'etd', e.target.value)}
                                                />
                                            </td>
                                            <td onClick={(e) => e.stopPropagation()}>
                                                <input
                                                    type="text"
                                                    className="po-input-text"
                                                    style={{ width: '100%' }}
                                                    placeholder="Container #"
                                                    value={ui.containerNumber || ""}
                                                    onChange={(e) => handleUserInput(key, 'containerNumber', e.target.value)}
                                                />
                                            </td>
                                            <td onClick={(e) => e.stopPropagation()}>
                                                <input
                                                    type="text"
                                                    className="po-input-text"
                                                    style={{ width: '100%' }}
                                                    placeholder="Remarks"
                                                    value={ui.remarks || ""}
                                                    onChange={(e) => handleUserInput(key, 'remarks', e.target.value)}
                                                />
                                            </td>
                                            <td onClick={(e) => e.stopPropagation()}>
                                                <select 
                                                    className="po-input-text" 
                                                    style={{ width: '100%' }}
                                                    value={ui.userStatus || ""}
                                                    onChange={(e) => handleUserInput(key, 'userStatus', e.target.value)}
                                                >
                                                    <option value="">— Select —</option>
                                                    <option value="Pending">Pending</option>
                                                    <option value="In Transit">In Transit</option>
                                                    <option value="Arrived">Arrived</option>
                                                    <option value="Customs">Customs</option>
                                                    <option value="Delayed">Delayed</option>
                                                    <option value="Cancelled">Cancelled</option>
                                                </select>
                                            </td>
                                            <td style={{ textAlign: "right" }}><strong style={{ color: 'var(--text-primary)', fontSize: '1rem' }}>₱{fmt(po.totalAmount)}</strong></td>
                                        </tr>
                                        {isOpen && (
                                            <tr className="po-lines-row">
                                                <td colSpan={12}>
                                                    <div className="po-lines-wrap">
                                                        <table className="po-lines-table">
                                                            <thead>
                                                                <tr>
                                                                    <th style={{ width: 180 }}>Item ID</th>
                                                                    <th>Description</th>
                                                                    <th style={{ textAlign: 'right', width: 120 }}>Quantity</th>
                                                                    <th style={{ textAlign: 'right', width: 150 }}>Ext. Cost</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {po.lines && po.lines.length > 0 ? po.lines.map((line, i) => (
                                                                    <tr key={i}>
                                                                        <td>
                                                                            <span 
                                                                                className="db-inv-id si-clickable-id"
                                                                                onClick={(e) => { e.stopPropagation(); setSelectedId(line.inventoryId); }}
                                                                            >
                                                                                {line.inventoryId}
                                                                            </span>
                                                                        </td>
                                                                        <td style={{ color: 'var(--text-secondary)', fontWeight: '500' }}>{line.description}</td>
                                                                        <td style={{ textAlign: 'right', fontWeight: '700', color: 'var(--text-primary)' }}>
                                                                            {Number(line.qty).toLocaleString()} <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{line.uom}</span>
                                                                        </td>
                                                                        <td style={{ textAlign: 'right', fontWeight: '700', color: 'var(--accent-primary)' }}>₱{fmt(line.extCost)}</td>
                                                                    </tr>
                                                                )) : (
                                                                    <tr><td colSpan={4} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>No line items found for this order.</td></tr>
                                                                )}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {!loading && (
                    <div className="db-pagination">
                        <span className="db-page-info">Showing page <strong>{page}</strong></span>
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

            <aside className="po-right-panel">
                <div className="po-summary-card">
                    <h3 className="po-summary-title">
                        <IconActivity /> Analytics Summary
                    </h3>
                    
                    <div className="po-summary-item">
                        <span className="po-summary-label">Total Purchase Orders</span>
                        <span className="po-summary-value">{orders.length} Orders</span>
                    </div>

                    <div className="po-summary-item" style={{ color: summaryStats.pendingEtaCount > 0 ? 'var(--status-danger)' : 'inherit' }}>
                        <span className="po-summary-label">Pending ETA Updates</span>
                        <span className="po-summary-value">{summaryStats.pendingEtaCount}</span>
                    </div>

                    <div className="po-summary-item">
                        <span className="po-summary-label">Open Status</span>
                        <span className="po-summary-value">{summaryStats.openCount}</span>
                    </div>

                    <div className="po-summary-item po-summary-total">
                        <span className="po-summary-label">Total Value</span>
                        <span className="po-summary-value">₱{fmt(summaryStats.totalValue)}</span>
                    </div>
                </div>

                <div className="po-info-box">
                    <h4 className="po-info-title">
                        <IconInfo /> Module Guide
                    </h4>
                    <p className="po-info-text">
                        This module displays all Purchase Orders from Acumatica. You can track their status and manage ETA for upcoming deliveries.
                    </p>
                    <p className="po-info-text" style={{ marginTop: '0.75rem' }}>
                        Changes to ETA and User Status are persisted locally in your browser.
                    </p>
                </div>

                <div className="po-footer-note">
                    <span className="po-footer-text">KGS Purchasing System v1.2</span>
                </div>
            </aside>

            {selectedId && (
                <InventoryDetailModal inventoryId={selectedId} onClose={() => setSelectedId(null)} />
            )}
        </div>
    );
}
