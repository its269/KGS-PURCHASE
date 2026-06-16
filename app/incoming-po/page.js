"use client";

import { Fragment, useState, useEffect, useCallback, useRef } from "react";  
import { DataCache } from "@/lib/data-cache";
import { fetchWithAuth } from "@/lib/api-client";
import InventoryDetailModal from "@/components/InventoryDetailModal";
import "@/styles/dashboard.css";
import "@/styles/stock-items.css";
import "@/styles/po.css";

const PAGE_SIZE = 50;

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

export default function IncomingPOPage() {
    /* ── State ────────────────────────────────────────────── */
    const [orders, setOrders] = useState([]);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(false);
    const [search, setSearch] = useState("");
    const [debSearch, setDebSearch] = useState("");
    const [startDate, setStartDate] = useState("");
    const [status, setStatus] = useState("Open");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [expanded, setExpanded] = useState({}); // orderNbr -> bool
    const [selectedId, setSelectedId] = useState(null);

    const isInitialMount = useRef(true);

    // Initial restoration & Hydration fix
    useEffect(() => {
        const savedPage = localStorage.getItem("inc_po_filter_page");
        const initialPage = savedPage ? parseInt(savedPage) : 1;
        
        const savedSearch = localStorage.getItem("inc_po_filter_search") || "";
        const savedStart = localStorage.getItem("inc_po_filter_startDate") || "";
        const savedStatus = localStorage.getItem("inc_po_filter_status") || "Open";

        Promise.resolve().then(() => {
            setPage(initialPage);
            setSearch(savedSearch);
            setStartDate(savedStart);
            setStatus(savedStatus);

            const params = new URLSearchParams({
                page: String(initialPage),
                pageSize: String(PAGE_SIZE),
                startDate: savedStart,
                status: savedStatus
            });
            const cached = DataCache.get(`inc_po_orders_${params.toString()}`);
            if (cached) {
                setOrders(cached.orders ?? []);
                setHasMore(cached.hasMore ?? false);
            }
            isInitialMount.current = false;
        });
    }, []);

    // Save filters to localStorage
    useEffect(() => {
        if (!isInitialMount.current) {
            localStorage.setItem("inc_po_filter_page", page.toString());
            localStorage.setItem("inc_po_filter_search", search);
            localStorage.setItem("inc_po_filter_startDate", startDate);
            localStorage.setItem("inc_po_filter_status", status);
        }
    }, [page, search, startDate, status]);

    useEffect(() => {
        const t = setTimeout(() => setDebSearch(search), 150);
        return () => clearTimeout(t);
    }, [search]);

    useEffect(() => {
        if (isInitialMount.current) return;
        setPage(1);
    }, [debSearch, startDate, status]);

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
            const cacheKey = `inc_po_orders_${params.toString()}`;

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
            if (!isBackground) setError(err.message || "Failed to load incoming purchase orders.");
        } finally {
            setLoading(false);
        }
    }, [page, debSearch, startDate, status]);
    useEffect(() => {
        const params = new URLSearchParams({
            page: String(page),
            pageSize: String(PAGE_SIZE),
            startDate: startDate,
            status: status
        });
        if (debSearch) params.set("search", debSearch);
        const cacheKey = `inc_po_orders_${params.toString()}`;

        const cached = DataCache.get(cacheKey);
        if (cached) {
            Promise.resolve().then(() => fetchOrders(true));
        } else {
            Promise.resolve().then(() => fetchOrders(false));
        }
    }, [fetchOrders, page, debSearch, startDate, status]);

    const toggleExpand = (key) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

    return (
        <div className="po-root">
            <main className="po-main">
                <div className="db-page-title">
                    <h1>Incoming Purchase Orders</h1>
                    <p>Track and manage open purchase orders live from Acumatica ERP.</p>
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
                            <option value="Pending Printing">Pending Printing</option>
                            <option value="Pending Email">Pending Email</option>
                            <option value="Completed">Completed</option>
                            <option value="Cancelled">Cancelled</option>
                            <option value="Closed">Closed</option>
                        </select>
                    </div>

                    {(startDate || status !== "Open") && (
                        <button
                            className="po-reset-btn"
                            onClick={() => { setStartDate(""); setStatus("Open"); }}
                        >
                            Reset
                        </button>
                    )}

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

                    <button className="po-refresh-btn" onClick={() => fetchOrders()} disabled={loading}>    
                        {loading ? <div className="db-spinner" style={{ width: '14px', height: '14px', borderWidth: '2px' }}></div> : "Refresh"}
                    </button>
                </div>

                {error && <div className="si-error">{error}</div>}

                <div className="db-table-wrap">
                    <table className="db-table po-table">
                        <thead>
                            <tr>
                                <th style={{ width: 48 }}></th>
                                <th style={{ width: 140 }}>Order #</th>
                                <th style={{ width: 100 }}>Type</th>
                                <th>Vendor</th>
                                <th style={{ width: 140 }}>Status</th>
                                <th>Order Date</th>
                                <th style={{ textAlign: "right", width: 160 }}>Total Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && orders.length === 0 ? (
                                <tr><td colSpan={7} className="si-loading-cell">
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', padding: '4rem 0' }}>
                                        <div className="db-spinner db-spinner-lg"></div>
                                        <span style={{ fontWeight: '600', color: 'var(--text-secondary)' }}>Fetching orders...</span>
                                    </div>
                                </td></tr>
                            ) : orders.length === 0 ? (
                                <tr><td colSpan={7} className="si-empty-cell" style={{ padding: '4rem 0' }}>No purchase orders found.</td></tr>
                            ) : orders.map(po => {
                                const key = `${po.orderType}-${po.orderNbr}`;
                                const isOpen = !!expanded[key];
                                return (
                                    <Fragment key={key}>
                                        <tr className={`db-clickable-row ${isOpen ? "po-row-expanded" : ""}`} onClick={() => toggleExpand(key)}>
                                            <td>
                                                <span className={`po-expand-icon ${isOpen ? "po-expand-open" : ""}`}>
                                                    <IconChevronDown />
                                                </span>
                                            </td>
                                            <td><span className="db-inv-id">{po.orderNbr}</span></td>
                                            <td><span style={{ fontSize: '0.75rem', fontWeight: '800', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>{po.orderType}</span></td>
                                            <td>
                                                <div className="po-vendor-cell">
                                                    <span className="po-vendor-name">{po.vendorName || po.vendorId}</span>
                                                    <span className="po-vendor-id">{po.vendorId}</span>
                                                </div>
                                            </td>
                                            <td>
                                                <span className={`db-badge ${poStatusClass(po.status)}`}>{po.status || "—"}</span>
                                            </td>
                                            <td><span style={{ fontSize: '0.85rem', fontWeight: '500', color: 'var(--text-secondary)' }}>{fmtDate(po.date)}</span></td>
                                            <td style={{ textAlign: "right" }}><strong style={{ color: 'var(--text-primary)', fontSize: '1rem' }}>₱{fmt(po.totalAmount)}</strong></td>
                                        </tr>
                                        {isOpen && (
                                            <tr className="po-lines-row">
                                                <td colSpan={7}>      
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
                        <span className="db-page-info">Showing page <strong>{page}</strong> of data</span>
                        <div className="db-page-btns">
                            <button className="db-page-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                                <IconChevronLeft />
                            </button>
                            <button className="db-page-btn" onClick={() => setPage(p => p + 1)} disabled={!hasMore}>
                                <IconChevronRight />
                            </button>
                        </div>
                    </div>
                )}
            </main>

            {selectedId && (
                <InventoryDetailModal inventoryId={selectedId} onClose={() => setSelectedId(null)} />
            )}
        </div>
    );
}
