"use client";

import { useState, useEffect, useCallback } from "react";
import { DataCache } from "@/lib/data-cache";
import { fetchWithAuth } from "@/lib/api-client";
import { withBasePath } from "@/lib/base-path";
import InventoryDetailModal from "@/components/InventoryDetailModal";
import "@/styles/dashboard.css";
import "@/styles/stock-items.css";

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
const IconDownload = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
    </svg>
);

/* ── Main Page ──────────────────────────────────────────── */
export default function StockItemsPage() {
    const [items, setItems] = useState([]);
    const [dataSource, setDataSource] = useState("mysql");
    const [totalCount, setTotalCount] = useState(0);
    const [totalStock, setTotalStock] = useState(0);
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selectedId, setSelectedId] = useState(null);
    const [exporting, setExporting] = useState(false);

    const handleExport = async () => {
        setExporting(true);
        try {
            window.location.href = withBasePath("/api/export?type=inventory");
        } catch (e) {
            console.error("Export failed", e);
        } finally {
            setTimeout(() => setExporting(false), 2000);
        }
    };

    // Initial restoration & Hydration fix
    useEffect(() => {
        Promise.resolve().then(() => {
            const params = new URLSearchParams({ page: "1", pageSize: String(PAGE_SIZE) });
            const cached = DataCache.get(`stock_items_${params.toString()}`);
            if (cached) {
                setItems(cached.items ?? []);
                setTotalCount(cached.totalCount ?? 0);
                setTotalStock(cached.totalStock ?? 0);
            }
        });
    }, []);

    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(search), 300);
        return () => clearTimeout(t);
    }, [search]);

    useEffect(() => {
        Promise.resolve().then(() => setPage(1));
    }, [debouncedSearch]);

    const fetchItems = useCallback(async (isBackground = false) => {
        if (!isBackground) setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
            if (debouncedSearch) params.set("search", debouncedSearch);
            const cacheKey = `stock_items_${params.toString()}`;

            const res = await fetchWithAuth(`/api/stock-items?${params}`);
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.message || `HTTP ${res.status}`);
            }
            const data = await res.json();
            setItems(data.items ?? []);
            setDataSource(data.source || "mysql");
            setTotalCount(data.totalCount ?? 0);
            setTotalStock(data.totalStock ?? 0);
            DataCache.set(cacheKey, data);
        } catch (err) {
            if (err.message === "Unauthorized") return;
            if (!isBackground) setError(err.message || "Failed to load stock items. Please try again.");
        } finally {
            setLoading(false);
        }
    }, [page, debouncedSearch]);

    useEffect(() => {
        const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
        if (debouncedSearch) params.set("search", debouncedSearch);
        const cacheKey = `stock_items_${params.toString()}`;

        const cached = DataCache.get(cacheKey);
        if (cached) {
            Promise.resolve().then(() => fetchItems(true));
        } else {
            Promise.resolve().then(() => fetchItems(false));
        }
    }, [fetchItems, page, debouncedSearch]);

    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

    return (
        <div className="db-root">
            <main className="db-main">
                <div className="db-page-title">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <h1>Stock Items Masterlist</h1>
                        <span className={`db-data-source ${dataSource.includes("acumatica") ? 'db-data-source-fallback' : 'db-data-source-live'}`} style={{ fontSize: '0.65rem', padding: '0.2rem 0.6rem' }}>
                            {dataSource === "mysql" ? "Live from MySQL" : dataSource === "acumatica-fallback" ? "Fallback: Live ERP" : "Live from ERP"}
                        </span>
                    </div>
                    <p>View all products and their configurations. Click a row to see detailed branch availability.</p>
                </div>

                <div className="db-stats">
                    <div className="db-stat-card db-stat-blue">
                        <span className="db-stat-label">Total Product Types</span>
                        <span className="db-stat-value">{loading && totalCount === 0 ? "..." : (totalCount || 0).toLocaleString()}</span>
                        <span className="db-stat-sub">Distinct Inventory IDs</span>
                    </div>
                    <div className="db-stat-card">
                        <span className="db-stat-label">Total Stocks</span>
                        <span className="db-stat-value">{loading && totalStock === 0 ? "..." : (totalStock || 0).toLocaleString()}</span>
                        <span className="db-stat-sub">Sum of all On-Hand units</span>
                    </div>
                </div>

                <div className="db-toolbar">
                    <div className="db-toolbar-left">
                        <div className="db-search-wrapper" style={{ width: '100%', maxWidth: '500px' }}>
                            <IconSearch />
                            <input
                                className="db-search"
                                type="text"
                                placeholder="Search by ID or Description..."
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                            />
                        </div>
                    </div>
                    <div className="db-toolbar-right">
                        <button 
                            className="si-view-btn" 
                            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--text-primary)', color: 'var(--text-inverse)', border: 'none', padding: '0.6rem 1.25rem', height: '42px' }}
                            onClick={handleExport}
                            disabled={exporting}
                        >
                            <IconDownload /> {exporting ? "Exporting..." : "Export CSV"}
                        </button>
                        
                        <button className="db-refresh-btn" onClick={() => fetchItems()} disabled={loading}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                {loading && <div className="db-spinner" style={{ width: '14px', height: '14px', borderWidth: '2px', borderTopColor: 'var(--text-secondary)' }}></div>}
                                <span>{loading ? "Loading..." : "Refresh List"}</span>
                            </div>
                        </button>
                    </div>
                </div>

                {error && <div className="si-error">{error}</div>}

                <div className="db-table-wrap">
                    <table className="db-table">
                        <thead>
                            <tr>
                                <th style={{ width: '180px' }}>Inventory ID</th>
                                <th>Description</th>
                                <th style={{ width: '130px' }}>Branch</th>
                                <th style={{ width: '130px' }}>Item Class</th>
                                <th style={{ width: '100px', textAlign: 'center' }}>Price</th>
                                <th style={{ width: '80px', textAlign: 'center' }}>Unit</th>
                                <th style={{ width: '100px', textAlign: 'center' }}>Status</th>
                                <th style={{ width: '100px', textAlign: 'right' }}>Qty Sold</th>
                                <th style={{ width: '120px', textAlign: 'right' }}>Total Sales</th>
                                <th style={{ width: '120px', textAlign: 'center' }}>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && items.length === 0 ? (
                                <tr><td colSpan={10} className="si-loading-cell">
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                                        <div className="db-spinner db-spinner-lg"></div>
                                        <span>Fetching items...</span>
                                    </div>
                                </td></tr>
                            ) : items.length === 0 ? (
                                <tr><td colSpan={10} className="si-empty-cell">No items found matching your search.</td></tr>
                            ) : items.map(item => (
                                <tr
                                    key={item.inventoryId}
                                    className={`db-clickable-row ${selectedId === item.inventoryId ? "si-row-selected" : ""}`}
                                    onClick={() => setSelectedId(item.inventoryId)}
                                >
                                    <td><span className="db-inv-id">{item.inventoryId}</span></td>
                                    <td className="db-desc" style={{ fontWeight: '500' }}>{item.description}</td>
                                    <td>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                            {item.branches ? item.branches.split(', ').map(b => (
                                                <span key={b} className="db-branch-tag" style={{ fontSize: '0.65rem' }}>{b}</span>
                                            )) : <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>No Stock</span>}
                                        </div>
                                    </td>
                                    <td><span className="db-class-tag">{item.itemClass}</span></td>
                                    <td className="db-num">₱{(Number(item.price) || 0).toLocaleString()}</td>
                                    <td style={{ textAlign: 'center' }}>{item.baseUnit}</td>
                                    <td style={{ textAlign: 'center' }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                                            <span className={`idm-status-pill idm-status-pill-sm ${item.itemStatus?.toLowerCase() === 'active' ? 'status-in' : 'status-out'}`}>
                                                {item.itemStatus}
                                            </span>
                                            {item.totalOnHand <= 0 ? (
                                                <span className="db-status-badge db-status-out" style={{ fontSize: '0.6rem' }}>OUT OF STOCK</span>
                                            ) : item.totalOnHand < 10 ? (
                                                <span className="db-status-badge db-status-low" style={{ fontSize: '0.6rem' }}>LOW STOCK</span>
                                            ) : null}
                                        </div>
                                    </td>
                                    <td className="db-num" style={{ fontWeight: '500' }}>{Number(item.totalQtySold) > 0 ? Number(item.totalQtySold).toLocaleString() : "—"}</td>
                                    <td className="db-num" style={{ color: 'var(--accent-primary)' }}>{Number(item.totalSales) > 0 ? `₱${Number(item.totalSales).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "—"}</td>
                                    <td style={{ textAlign: 'center' }}>
                                        <button className="si-view-btn">View Details</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {!loading && totalPages > 1 && (
                    <div className="db-pagination">
                        <span className="db-page-info">
                            Showing <strong>{((page - 1) * PAGE_SIZE) + 1}</strong> to <strong>{Math.min(page * PAGE_SIZE, totalCount)}</strong> of <strong>{totalCount}</strong> items
                        </span>
                        <div className="db-page-btns">
                            <button className="db-page-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                                <IconChevronLeft />
                            </button>
                            <span className="db-page-dots">Page {page} of {totalPages}</span>
                            <button className="db-page-btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
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
