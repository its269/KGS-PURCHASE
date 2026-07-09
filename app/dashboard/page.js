"use client";

import { useEffect, useState, useCallback, useRef, memo } from "react";
import { DataCache } from "@/lib/data-cache";
import { fetchWithAuth } from "@/lib/api-client";
import "@/styles/dashboard.css";

/* ── SVG Icons ─────────────────────────────────────────────── */
const IconBarChart = memo(() => (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
        <line x1="2" y1="20" x2="22" y2="20" />
    </svg>
));
IconBarChart.displayName = "IconBarChart";

const IconLogout = memo(() => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
));
IconLogout.displayName = "IconLogout";
const IconSearch = memo(() => (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
));
IconSearch.displayName = "IconSearch";
const IconChevron = memo(() => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9" />
    </svg>
));
IconChevron.displayName = "IconChevron";
const IconBox = memo(() => (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
));
IconBox.displayName = "IconBox";
const IconFilter = memo(() => (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
));
IconFilter.displayName = "IconFilter";
const IconRefresh = memo(() => (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
));
IconRefresh.displayName = "IconRefresh";
const IconSync = memo(() => (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
        <path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    </svg>
));
IconSync.displayName = "IconSync";
const IconClose = memo(() => (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
));
IconClose.displayName = "IconClose";

/* ── Constants ────────────────────────────────────────────── */
const ROWS_PER_PAGE = 15;
const LOW_STOCK_THRESHOLD = 10;
const EMPTY_GLOBAL_STATS = {
    totalStock: 0,
    totalValue: 0,
    lowStock: 0,
    totalLowStock: 0,
    outOfStock: 0,
    deadStock: 0,
    overstock: 0,
    lastSync: null,
};
const cellVal = (row, key) => {
    const val = row[key]?.value;
    if (val === null || val === undefined || val === "") return "—";
    if (typeof val === "object") return "—";
    return val;
};

const cellNum = (row, key) => {
    const val = row[key]?.value;
    if (val === null || val === undefined || val === "") return "—";
    const n = Number(val);
    return Number.isFinite(n) ? n.toLocaleString() : String(val);
};

/* ── Table Row Component ───────────────────────────────────── */
const InventoryRow = memo(({ row }) => (
    <tr>
        <td><span className="db-inv-id">{cellVal(row, "InventoryID")}</span></td>
        <td className="db-desc">{cellVal(row, "Description")}</td>
        <td><span className="db-class-tag">{cellVal(row, "Category")}</span></td>
        <td>{cellVal(row, "SupplierID")}</td>
        <td className="db-num">{cellNum(row, "LeadTimeDays")}</td>
        <td className="db-num">{cellNum(row, "SafetyStock")}</td>
        <td className="db-num">{cellNum(row, "MOQ")}</td>
    </tr>
));
InventoryRow.displayName = "InventoryRow";

export default function DashboardPage() {
    /* ── State ────────────────────────────────────────────── */
    const [selectedBranch, setSelectedBranch] = useState("");
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [userName, setUserName] = useState("User");

    const [allInventory, setAllInventory] = useState([]);
    const [dataSource, setDataSource] = useState("mysql");
    const [totalCount, setTotalCount] = useState(0);
    const [globalStats, setGlobalStats] = useState({
        ...EMPTY_GLOBAL_STATS,
        count: 0,
    });
    const [activeFilter, setActiveFilter] = useState(null);
    const [hasMore, setHasMore] = useState(false);

    const [branchOptions, setBranchOptions] = useState([]);
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [loading, setLoading] = useState(true);
    const [companyLabel, setCompanyLabel] = useState("KGSC");

    const inventoryCachePrefix = () =>
        `inventory_${localStorage.getItem("activeCompanyId") || "main"}_`;

    const clearInventoryCache = () => DataCache.deleteByPrefix(inventoryCachePrefix());

    const shouldUseCachedStats = (stats) =>
        stats && stats.dataMode !== "warehouse-missing";

    // Hydration fix & Initial Restoration
    useEffect(() => {
        Promise.resolve().then(() => {
            const b = localStorage.getItem("db_filter_branch") || "";
            const s = localStorage.getItem("db_filter_search") || "";
            const p = parseInt(localStorage.getItem("db_filter_page") || "1");
            const u = localStorage.getItem("userName") || "User";

            if (b) setSelectedBranch(b);
            if (s) setSearch(s);
            if (p > 1) setPage(p);
            if (u !== "User") setUserName(u);

            const params = new URLSearchParams({
                page: String(p),
                pageSize: String(ROWS_PER_PAGE),
                search: s,
                branch: b,
                count: "true",
                stats: "true",
                source: "mysql"
            });
            const cached = DataCache.get(`${inventoryCachePrefix()}${params.toString()}`);
            if (cached) {
                setAllInventory(cached.data || []);
                setTotalCount(cached.totalCount || 0);
                setHasMore(!!cached.hasMore);
                if (shouldUseCachedStats(cached.globalStats)) setGlobalStats(cached.globalStats);
            }
        });
    }, []);

    useEffect(() => {
        const loadCompany = () => {
            fetchWithAuth("/api/company")
                .then((res) => (res.ok ? res.json() : null))
                .then((data) => {
                    if (!data) return;
                    const active = data.companies?.find((c) => c.id === data.activeCompanyId);
                    setCompanyLabel(active?.label || "KGSC");
                })
                .catch(() => {});
        };
        loadCompany();
        const onCompanyChange = () => {
            setPage(1);
            setAllInventory([]);
            DataCache.clear();
            loadCompany();
            setSelectedBranch("");
        };
        window.addEventListener("company-changed", onCompanyChange);
        return () => window.removeEventListener("company-changed", onCompanyChange);
    }, []);

    // Save filters to localStorage
    useEffect(() => {
        localStorage.setItem("db_filter_branch", selectedBranch);
        localStorage.setItem("db_filter_search", search);
        localStorage.setItem("db_filter_page", page.toString());
    }, [selectedBranch, search, page]);

    const handleBranchChange = (branchId) => {
        setSelectedBranch(branchId);
        setPage(1);
        setGlobalStats({ ...EMPTY_GLOBAL_STATS, count: 0 });
        setAllInventory([]);
        setTotalCount(0);
        clearInventoryCache();
    };

    const searchTimer = useRef(null);

    /* ── Init Data ────────────────────────────────────────── */
    useEffect(() => {
        const fetchBranches = async () => {
            const companyKey = localStorage.getItem("activeCompanyId") || "main";
            const cacheKey = `branches_${companyKey}`;
            const cached = DataCache.get(cacheKey);
            // Guard: only use cache if it's already the {id,name} format
            if (cached && Array.isArray(cached) && cached.length > 0 && typeof cached[0] === "object" && cached[0].id) {
                setBranchOptions(cached);
                if (!selectedBranch) {
                    const main = cached.find(b => b.id.toUpperCase() === "MAIN") || cached.find(b => b.id.toUpperCase().includes("MAIN"));
                    if (main) setSelectedBranch(main.id);
                }
            }

            try {
                const res = await fetchWithAuth("/api/branches");
                if (res.ok) {
                    const data = await res.json();
                    const list = Array.isArray(data) ? data : (data?.value || []);
                    const options = list
                        .map(b => {
                            const rawName = b.Description?.value || b.BranchName?.value || b.branch_name || "";
                            const name = rawName && !rawName.startsWith("[object") ? rawName : (b.SiteID || b.branch_id || "");
                            return { id: b.SiteID || b.branch_id || "", name };
                        })
                        .filter(b => b.id)
                        .filter((b, i, arr) => arr.findIndex(x => x.id === b.id) === i)
                        .sort((a, z) => a.name.localeCompare(z.name));
                    setBranchOptions(options);
                    DataCache.set(cacheKey, options);

                    if (!selectedBranch || !options.some((b) => b.id === selectedBranch)) {
                        const main = options.find(b => b.id.toUpperCase() === "MAIN") || options.find(b => b.id.toUpperCase().includes("MAIN"));
                        if (main) setSelectedBranch(main.id);
                    }
                }
            } catch (err) { console.error("Branch fetch error", err); }
        };
        fetchBranches();

        const onCompanyChange = () => fetchBranches();
        window.addEventListener("company-changed", onCompanyChange);
        return () => window.removeEventListener("company-changed", onCompanyChange);
    }, []);

    /* ── Fetch Data ───────────────────────────────────────── */
    const fetchInventory = useCallback(async (isBackground = false) => {
        if (!isBackground) setLoading(true);
        try {
            const dataParams = new URLSearchParams({ page: String(page), pageSize: String(ROWS_PER_PAGE), search: debouncedSearch, branch: selectedBranch, count: "true", stats: "true", source: "mysql" });
            const cacheKey = `${inventoryCachePrefix()}${dataParams.toString()}`;

            const res = await fetchWithAuth(`/api/inventory?${dataParams.toString()}`);
            if (res.ok) {
                const result = await res.json();
                setAllInventory(result.data || []);
                setDataSource(result.source || "mysql");
                setTotalCount(result.totalCount || 0);
                setHasMore(!!result.hasMore);
                if (result.globalStats) setGlobalStats(result.globalStats);
                DataCache.set(cacheKey, result);
            }
        } catch (e) { 
            if (e.message !== "Unauthorized") console.error("Fetch error", e); 
        }
        setLoading(false);
    }, [page, debouncedSearch, selectedBranch]);

    useEffect(() => {
        clearTimeout(searchTimer.current);
        searchTimer.current = setTimeout(() => {
            setDebouncedSearch(search);
            setPage(1);
        }, 300);
        return () => clearTimeout(searchTimer.current);
    }, [search]);

    useEffect(() => {
        const dataParams = new URLSearchParams({ page: String(page), pageSize: String(ROWS_PER_PAGE), search: debouncedSearch, branch: selectedBranch, count: "true", stats: "true", source: "mysql" });
        const cacheKey = `${inventoryCachePrefix()}${dataParams.toString()}`;

        const cached = DataCache.get(cacheKey);
        if (cached) {
            setAllInventory(cached.data || []);
            setTotalCount(cached.totalCount || 0);
            setHasMore(!!cached.hasMore);
            if (shouldUseCachedStats(cached.globalStats)) setGlobalStats(cached.globalStats);
            // Re-fetch in background
            Promise.resolve().then(() => fetchInventory(true));
        } else {
            Promise.resolve().then(() => fetchInventory(false));
        }
    }, [page, debouncedSearch, selectedBranch, fetchInventory]);

    const isStale = globalStats.lastSync && (new Date() - new Date(globalStats.lastSync)) > 86400000;

    /* ── Render ───────────────────────────────────────────── */
    return (
        <div className="db-root">
            <main className="db-main">
                <div className="db-page-title">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <h1>Inventory Dashboard</h1>
                        <span className="db-company-badge">{companyLabel}</span>
                        <span className={`db-data-source ${dataSource === "mysql" || dataSource === "mysql-catalog" ? "db-data-source-live" : "db-data-source-fallback"}`} suppressHydrationWarning>
                            {dataSource === "mysql"
                                ? "Live from MySQL"
                                : dataSource === "mysql-catalog"
                                ? "Product catalog"
                                : dataSource === "acumatica-live"
                                ? "Live from ERP"
                                : dataSource === "acumatica-fallback"
                                ? "Fallback: Live ERP"
                                : "Live from ERP"}
                        </span>
                    </div>
                    <p>Manage and monitor stock levels across all locations.</p>
                    {globalStats.dataMode === "warehouse-missing" && (
                        <p className="db-catalog-hint">
                            Branch stock has not been loaded yet. Run a full Inventory sync from Sync Center to populate warehouse totals.
                        </p>
                    )}
                </div>

                <div className="db-stats">
                <div className="db-stat-card">
                    <span className="db-stat-label">Total Stocks</span>
                    <span className="db-stat-value">{(globalStats.totalStock || 0).toLocaleString()}</span>
                    <span className="db-stat-sub">{(globalStats.count ?? totalCount).toLocaleString()} products in {selectedBranch || "all branches"}</span>
                </div>
                <div className="db-stat-card">
                    <span className="db-stat-label">Total Value</span>
                    <span className="db-stat-value">₱{(globalStats.totalValue || 0).toLocaleString("en-PH", { minimumFractionDigits: 0 })}</span>
                    <span className="db-stat-sub">Estimated inventory value</span>
                </div>
                <div className="db-stat-card db-stat-warn db-stat-clickable" onClick={() => setActiveFilter("low_stock")}>
                    <span className="db-stat-label">Low Stock (Units)</span>
                    <span className="db-stat-value">{(globalStats.totalLowStock || 0).toLocaleString()}</span>
                    <span className="db-stat-sub">{(globalStats.lowStock || 0)} products under {LOW_STOCK_THRESHOLD} units</span>
                </div>
                <div className="db-stat-card db-stat-danger db-stat-clickable" onClick={() => setActiveFilter("out_of_stock")}>
                    <span className="db-stat-label">Out of Stock</span>
                    <span className="db-stat-value">{(globalStats.outOfStock || 0).toLocaleString()}</span>
                    <span className="db-stat-sub">Zero units on hand</span>
                </div>
                <div className="db-stat-card db-stat-warn db-stat-clickable" onClick={() => setActiveFilter("dead_stock")}>
                    <span className="db-stat-label">Dead Stock</span>
                    <span className="db-stat-value">{(globalStats.deadStock || 0).toLocaleString()}</span>
                    <span className="db-stat-sub">Zero sales in 90 days</span>
                </div>
                <div className="db-stat-card db-stat-info db-stat-clickable" onClick={() => setActiveFilter("overstock")}>
                    <span className="db-stat-label">Overstock</span>
                    <span className="db-stat-value">{(globalStats.overstock || 0).toLocaleString()}</span>
                    <span className="db-stat-sub">{">"}180 days of supply</span>
                </div>
                <div className={`db-stat-card ${isStale ? "db-stat-danger db-stat-stale" : "db-stat-info"}`}>
                    <span className="db-stat-label">Data Freshness</span>
                    <span className="db-stat-value db-stat-value-sm">
                        {globalStats.lastSync ? new Date(globalStats.lastSync).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : "Never"}
                    </span>
                    <span className="db-stat-sub">{isStale ? "Warning: Data is stale (>24h)" : "Last successful sync"}</span>
                </div>
                </div>

                <div className="db-toolbar">
                    <div className="db-toolbar-left">
                        <div className="db-select-wrapper">
                            <IconFilter />
                            <select className="db-select" value={selectedBranch} onChange={(e) => handleBranchChange(e.target.value)}>
                                <option value="">All Branches</option>
                                {branchOptions.map(b => <option key={b.id} value={b.id}>{b.id}</option>)}
                            </select>
                            <IconChevron />
                        </div>
                        <div className="db-search-wrapper">
                            <IconSearch />
                            <input className="db-search" type="text" placeholder="Search ID or description..." value={search} onChange={(e) => setSearch(e.target.value)} />
                        </div>
                    </div>
                    <div className="db-toolbar-right">
                        <button className="db-refresh-btn" onClick={() => { clearInventoryCache(); fetchInventory(); }}><IconRefresh /> <span>Refresh</span></button>
                    </div>
                </div>

                <div className="db-table-wrap">
                    {loading ? (
                        <div className="db-loading"><div className="db-spinner" /><span>Loading data...</span></div>
                    ) : (
                        <table className="db-table">
                            <thead>
                                <tr>
                                    <th>Inventory ID</th>
                                    <th>Description</th>
                                    <th>Category</th>
                                    <th>SupplierID</th>
                                    <th className="db-num">LeadTimeDays</th>
                                    <th className="db-num">SafetyStock</th>
                                    <th className="db-num">MOQ</th>
                                </tr>
                            </thead>
                            <tbody>
                                {allInventory.map((row, i) => (
                                    <InventoryRow
                                        key={`${row.InventoryID?.value ?? "row"}-${row.Branch?.value ?? ""}-${i}`}
                                        row={row}
                                    />
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                <div className="db-pagination">
                    <span className="db-page-info">Showing {allInventory.length} items</span>
                    <div className="db-page-btns">
                        <button className="db-page-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>&lsaquo;</button>
                        <span className="db-page-dots">Page {page}</span>
                        <button className="db-page-btn" disabled={!hasMore} onClick={() => setPage(p => p + 1)}>&rsaquo;</button>
                    </div>
                </div>

            </main>

            {activeFilter && (
                <FilteredStockModal
                    filter={activeFilter}
                    branch={selectedBranch}
                    onClose={() => setActiveFilter(null)}
                />
            )}
        </div>
    );
}

function FilteredStockModal({ filter, branch, onClose }) {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const title = filter === "low_stock" ? "Low Stock Items"
        : filter === "out_of_stock" ? "Out of Stock Items"
        : filter === "dead_stock" ? "Dead Stock (No sales in 90 days)"
        : filter === "overstock" ? "Overstock Items (Excessive Supply)"
        : "Filtered Items";

    useEffect(() => {
        const fetchFiltered = async () => {
            setLoading(true);
            try {
                const params = new URLSearchParams({
                    page: "1",
                    pageSize: "100",
                    branch,
                    filter,
                    source: "mysql",
                });
                const res = await fetchWithAuth(`/api/inventory?${params}`);
                if (!res.ok) throw new Error("Failed to fetch filtered list");
                const result = await res.json();
                setItems(result.data || []);
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };
        fetchFiltered();
    }, [filter, branch]);

    return (
        <div className="db-modal-overlay" onClick={onClose}>
            <div className="db-modal" style={{ maxWidth: "800px" }} onClick={(e) => e.stopPropagation()}>
                <div className="db-modal-header">
                    <h2 className="db-modal-title">{title}</h2>
                    <button className="db-modal-close" onClick={onClose}><IconClose /></button>
                </div>
                <div className="db-modal-body" style={{ padding: 0 }}>
                    {loading ? (
                        <div style={{ padding: "3rem", textAlign: "center" }}>
                            <div className="db-spinner" style={{ margin: "0 auto 1rem" }} />
                            <p style={{ fontWeight: "600", color: "var(--text-secondary)" }}>Loading items...</p>
                        </div>
                    ) : error ? (
                        <div style={{ padding: "3rem", textAlign: "center", color: "var(--status-danger)" }}>{error}</div>
                    ) : items.length === 0 ? (
                        <div style={{ padding: "3rem", textAlign: "center", color: "var(--text-muted)" }}>No items found for this filter.</div>
                    ) : (
                        <table className="db-table" style={{ fontSize: "0.85rem" }}>
                            <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
                                <tr>
                                    <th style={{ padding: "1rem" }}>ID</th>
                                    <th>Description</th>
                                    <th className="db-num">On Hand</th>
                                    <th>Branch</th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.map((item, i) => (
                                    <tr key={i}>
                                        <td style={{ padding: "0.75rem 1rem" }}><span className="db-inv-id">{cellVal(item, "InventoryID")}</span></td>
                                        <td>{cellVal(item, "Description")}</td>
                                        <td className="db-num" style={{ fontWeight: "700" }}>
                                            <span className={Number(item.OnHand?.value) > 0 ? "db-badge db-badge-green" : "db-badge db-status-out"}>
                                                {Number(item.OnHand?.value).toLocaleString()}
                                            </span>
                                        </td>
                                        <td>{cellVal(item, "Branch")}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
                <div className="db-modal-footer">
                    <button className="db-action-btn" onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    );
}
