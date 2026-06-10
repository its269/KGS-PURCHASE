"use client";

import { Fragment, useState, useEffect, useCallback, useRef } from "react";  
import { DataCache } from "@/lib/data-cache";
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

            const res = await fetch(`/api/po?${params}`);
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                if (!isBackground) throw new Error(body.message || `HTTP ${res.status}`);
                return;
            }
            const data = await res.json();
            setOrders(data.orders ?? []);
            setHasMore(data.hasMore ?? false);
            DataCache.set(cacheKey, data);
        } catch (err) {
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
        <div className="db-root">
            <main className="db-main">
                <div className="db-page-title">
                    <h1>Incoming Purchase Orders</h1>
                    <p>Track and manage open purchase orders live from Acumatica ERP.</p>
                </div>

                <div className="db-toolbar" style={{ height: 'auto', padding: '1.25rem' }}>
                    <div className="db-toolbar-left" style={{ flexWrap: 'wrap', gap: '1rem' }}>
                        <div className="db-select-wrapper" style={{ paddingLeft: '0.75rem', paddingRight: '0.5rem', minWidth: 'fit-content', height: '42px' }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: '700', color: '#64748b', marginRight: '0.5rem', textTransform: 'uppercase' }}>From:</span>
                            <input
                                type="date"
                                className="db-select"
                                style={{ width: '135px', padding: '0 0.25rem', height: '36px', fontSize: '0.8rem' }}
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                            />
                            {!startDate && (
                                <span style={{ fontSize: '0.7rem', color: '#94a3b8', fontStyle: 'italic', marginLeft: '0.5rem' }}>
                                    (Current Month)
                                </span>
                            )}
                        </div>

                        <div className="db-select-wrapper" style={{ paddingLeft: '0.75rem', paddingRight: '0.5rem', minWidth: 'fit-content', height: '42px' }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: '700', color: '#64748b', marginRight: '0.5rem', textTransform: 'uppercase' }}>Status:</span>
                            <select
                                className="db-select"
                                style={{ width: '140px', padding: '0 0.25rem', height: '36px', fontSize: '0.8rem' }}
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
                                onClick={() => { setStartDate(""); setStatus("Open"); }}
                                style={{ background: '#fee2e2', border: 'none', color: '#ef4444', fontSize: '0.7rem', cursor: 'pointer', padding: '6px 12px', borderRadius: '8px', fontWeight: '700', textTransform: 'uppercase' }}
                            >
                                Reset Filters
                            </button>
                        )}

                        <div className="db-search-wrapper" style={{ flex: '1', minWidth: '250px', height: '42px' }}>
                            <IconSearch />
                            <input
                                className="db-search"
                                type="text"
                                placeholder="Search Order #, Vendor, or Item..."
                                style={{ height: '40px', fontSize: '0.85rem' }}
                                value={search}
                                onChange={e => setSearch(e.target.value)}
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
                                        color: '#94a3b8', 
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
                    <div className="db-toolbar-right">
                        <button className="db-refresh-btn" onClick={() => fetchOrders()} disabled={loading}>    
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                {loading && <div className="db-spinner" style={{ width: '14px', height: '14px', borderWidth: '2px' }}></div>}
                                <span>{loading ? "Loading..." : "Refresh"}</span>
                            </div>
                        </button>
                    </div>
                </div>

                {error && <div className="si-error">{error}</div>}

                <div className="db-table-wrap">
                    <table className="db-table po-table">
                        <thead>
                            <tr>
                                <th style={{ width: 40 }}></th>
                                <th style={{ width: 140 }}>Order #</th>
                                <th>Type</th>
                                <th>Vendor</th>
                                <th style={{ width: 150 }}>Status</th>
                                <th>Order Date</th>
                                <th style={{ textAlign: "right" }}>Total Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && orders.length === 0 ? (
                                <tr><td colSpan={7} className="si-loading-cell">
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                                        <div className="db-spinner db-spinner-lg"></div>
                                        <span>Fetching orders...</span>
                                    </div>
                                </td></tr>
                            ) : orders.length === 0 ? (
                                <tr><td colSpan={7} className="si-empty-cell">No purchase orders found for current filters.</td></tr>
                            ) : orders.map(po => {
                                const key = `${po.orderType}-${po.orderNbr}`;
                                const isOpen = !!expanded[key];
                                return (
                                    <Fragment key={key}>
                                        <tr className={`db-clickable-row ${isOpen ? "po-row-expanded" : ""}`} onClick={() => toggleExpand(key)}>
                                            <td>
                                                <span className={`po-expand-icon ${isOpen ? "po-expand-open" : ""}`} style={{ color: '#94a3b8' }}>
                                                    <IconChevronDown />
                                                </span>
                                            </td>
                                            <td><span className="db-inv-id" style={{ background: '#eff6ff', borderColor: '#dbeafe' }}>{po.orderNbr}</span></td>
                                            <td><span style={{ fontSize: '0.75rem', fontWeight: '600', color: '#64748b' }}>{po.orderType}</span></td>
                                            <td>
                                                <div style={{ fontWeight: '700', color: '#0f172a', fontSize: '0.85rem' }}>{po.vendorName || po.vendorId}</div>
                                                <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{po.vendorId}</div>
                                            </td>
                                            <td>
                                                <span className={`db-status-badge ${poStatusClass(po.status)}`}>{po.status || "—"}</span>
                                            </td>
                                            <td><span style={{ fontSize: '0.8rem', color: '#475569' }}>{fmtDate(po.date)}</span></td>
                                            <td style={{ textAlign: "right" }}><strong style={{ color: '#0f172a' }}>₱{fmt(po.totalAmount)}</strong></td>
                                        </tr>
                                        {isOpen && po.lines.length > 0 && (
                                            <tr className="po-lines-row">
                                                <td colSpan={7} style={{ padding: '0 1rem 1rem 3.5rem' }}>      
                                                    <div className="po-lines-wrap" style={{ borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
                                                        <table className="po-lines-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                                                            <thead style={{ background: '#f8fafc' }}>
                                                                <tr>
                                                                    <th style={{ textAlign: 'left', padding: '0.75rem' }}>Item</th>
                                                                    <th style={{ textAlign: 'left', padding: '0.75rem' }}>Description</th>
                                                                    <th style={{ textAlign: 'right', padding: '0.75rem' }}>Qty</th>
                                                                    <th style={{ textAlign: 'right', padding: '0.75rem' }}>Ext. Cost</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {po.lines.map((line, i) => (
                                                                    <tr key={i} style={{ borderTop: '1px solid #f1f5f9' }}>
                                                                        <td style={{ padding: '0.75rem' }}>     
                                                                            <span 
                                                                                className="db-inv-id si-clickable-id"
                                                                                style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem', cursor: 'pointer' }}
                                                                                onClick={(e) => { e.stopPropagation(); setSelectedId(line.inventoryId); }}
                                                                            >
                                                                                {line.inventoryId}
                                                                            </span>
                                                                        </td>
                                                                        <td style={{ padding: '0.75rem', color: '#64748b' }}>{line.description}</td>
                                                                        <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: '700' }}>{Number(line.qty).toLocaleString()} {line.uom}</td>
                                                                        <td style={{ padding: '0.75rem', textAlign: 'right', color: '#0f172a' }}>₱{fmt(line.extCost)}</td>
                                                                    </tr>
                                                                ))}
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
                        <span className="db-page-info">Page <strong>{page}</strong></span>
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
