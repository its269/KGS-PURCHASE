"use client";

import { useEffect, useState, useCallback, useMemo, useRef, memo } from "react";
import { useRouter } from "next/navigation";
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

const getStatus = (onHand) => {
    if (onHand <= 0) return "OUT_OF_STOCK";
    if (onHand <= LOW_STOCK_THRESHOLD) return "LOW_STOCK";
    return "IN_STOCK";
};
const STATUS_LABEL = { IN_STOCK: "In Stock", LOW_STOCK: "Low Stock", OUT_OF_STOCK: "Out of Stock" };
const STATUS_CLASS = { IN_STOCK: "db-status-in", LOW_STOCK: "db-status-low", OUT_OF_STOCK: "db-status-out" };
const cellVal = (row, key) => {
    const val = row[key]?.value;
    if (val === null || val === undefined) return "—";
    if (typeof val === "object") return "—";
    return val;
};

/* ── Table Row Component ───────────────────────────────────── */
const InventoryRow = memo(({ row, index }) => {
    const onHand = Number(row.OnHand?.value) || 0;
    const available = Number(row.Available?.value) || 0;
    const status = getStatus(onHand);
    const price = Number(row.DefaultPrice?.value) || 0;
    const qtySold = Number(row.QtySold?.value) || 0;
    const totalSales = Number(row.TotalSales?.value) || 0;

    return (
        <tr
            className={`${status === "LOW_STOCK" ? "db-row-warn" : status === "OUT_OF_STOCK" ? "db-row-danger" : ""}`}
        >
            <td className="db-row-num">{index}</td>
            <td><span className="db-inv-id">{cellVal(row, "InventoryID")}</span></td>
            <td className="db-desc">{cellVal(row, "Description")}</td>
            <td><span className="db-branch-tag">{cellVal(row, "Branch")}</span></td>
            <td>{cellVal(row, "SiteID")}</td>
            <td className="db-num"><span className={onHand > 0 ? "db-badge db-badge-green" : "db-badge"}>{onHand.toLocaleString()}</span></td>
            <td className="db-num"><span className={available > 0 ? "db-badge db-badge-blue" : "db-badge"}>{available.toLocaleString()}</span></td>
            <td className="db-num">₱{price.toLocaleString("en-PH", { minimumFractionDigits: 2 })}</td>
            <td><span className="db-class-tag">{cellVal(row, "ItemClass")}</span></td>
            <td><span className={`db-status-badge ${STATUS_CLASS[status]}`}>{STATUS_LABEL[status]}</span></td>
            <td className="db-num">{qtySold > 0 ? qtySold.toLocaleString("en-PH", { minimumFractionDigits: 2 }) : "—"}</td>
            <td className="db-num">{totalSales > 0 ? `₱${totalSales.toLocaleString("en-PH", { minimumFractionDigits: 2 })}` : "—"}</td>
        </tr>
    );
});
InventoryRow.displayName = "InventoryRow";

export default function DashboardPage() {
    const router = useRouter();

    /* ── State ────────────────────────────────────────────── */
    const [selectedBranch, setSelectedBranch] = useState("");
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [userName, setUserName] = useState("User");

    const [allInventory, setAllInventory] = useState([]);
    const [dataSource, setDataSource] = useState("mysql");
    const [totalCount, setTotalCount] = useState(0);
    const [globalStats, setGlobalStats] = useState({ totalValue: 0, lowStock: 0, outOfStock: 0 });
    const [hasMore, setHasMore] = useState(false);

    const [branchOptions, setBranchOptions] = useState([]);
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [loading, setLoading] = useState(true);
    const [showQuickSync, setShowQuickSync] = useState(false);

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
            const cached = DataCache.get(`inventory_${params.toString()}`);
            if (cached) {
                setAllInventory(cached.data || []);
                setTotalCount(cached.totalCount || 0);
                setHasMore(!!cached.hasMore);
                if (cached.globalStats) setGlobalStats(cached.globalStats);
            }
        });
    }, []);

    // Save filters to localStorage
    useEffect(() => {
        localStorage.setItem("db_filter_branch", selectedBranch);
        localStorage.setItem("db_filter_search", search);
        localStorage.setItem("db_filter_page", page.toString());
    }, [selectedBranch, search, page]);
    const [showSyncConfirm, setShowSyncConfirm] = useState(false);

    const searchTimer = useRef(null);
    const syncingRef = useRef(false);

    /* ── Init Data ────────────────────────────────────────── */
    useEffect(() => {
        const fetchBranches = async () => {
            const cacheKey = "branches";
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

                    if (!selectedBranch) {
                        const main = options.find(b => b.id.toUpperCase() === "MAIN") || options.find(b => b.id.toUpperCase().includes("MAIN"));
                        if (main) setSelectedBranch(main.id);
                    }
                }
            } catch (err) { console.error("Branch fetch error", err); }
        };
        fetchBranches();
    }, []);

    /* ── Fetch Data ───────────────────────────────────────── */
    const fetchInventory = useCallback(async (isBackground = false) => {
        if (!isBackground) setLoading(true);
        try {
            const dataParams = new URLSearchParams({ page: String(page), pageSize: String(ROWS_PER_PAGE), search: debouncedSearch, branch: selectedBranch, count: "true", stats: "true", source: "mysql" });
            const cacheKey = `inventory_${dataParams.toString()}`;

            const res = await fetchWithAuth(`/api/inventory?${dataParams.toString()}`);
            if (res.status === 401) { router.push("/signin"); return; }
            if (res.ok) {
                const result = await res.json();
                setAllInventory(result.data || []);
                setDataSource(result.source || "mysql");
                setTotalCount(result.totalCount || 0);
                setHasMore(!!result.hasMore);
                if (result.globalStats) setGlobalStats(result.globalStats);
                DataCache.set(cacheKey, result);
            }
        } catch (e) { console.error("Fetch error", e); }
        setLoading(false);
    }, [page, debouncedSearch, selectedBranch, router]);

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
        const cacheKey = `inventory_${dataParams.toString()}`;

        const cached = DataCache.get(cacheKey);
        if (cached) {
            // Re-fetch in background
            Promise.resolve().then(() => fetchInventory(true));
        } else {
            Promise.resolve().then(() => fetchInventory(false));
        }
    }, [page, debouncedSearch, selectedBranch, fetchInventory]);

    const initials = useMemo(() => {
        const parts = userName.split(" ");
        if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        return userName.slice(0, 2).toUpperCase();
    }, [userName]);

    const selectedBranchName = useMemo(() => {
        if (!selectedBranch) return "All Branches";
        return selectedBranch;
    }, [selectedBranch]);

    /* ── Render ───────────────────────────────────────────── */
    return (
        <div className="db-root">
            <main className="db-main">
                <div className="db-page-title">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <h1>Inventory Dashboard</h1>
                        <span style={{ 
                            fontSize: '0.65rem', 
                            fontWeight: '800', 
                            textTransform: 'uppercase', 
                            padding: '0.2rem 0.6rem', 
                            background: dataSource.includes("acumatica") ? '#fff7ed' : '#ecfdf5', 
                            color: dataSource.includes("acumatica") ? '#c2410c' : '#059669', 
                            border: `1px solid ${dataSource.includes("acumatica") ? '#fb923c' : '#10b981'}`, 
                            borderRadius: '999px',
                            letterSpacing: '0.05em'
                        }}>{dataSource === "mysql" ? "Live from MySQL" : dataSource === "acumatica-fallback" ? "Fallback: Live ERP" : "Live from ERP"}</span>
                    </div>
                    <p>Manage and monitor stock levels across all locations.</p>
                </div>

                <div className="db-stats">
                    <div className="db-stat-card">
                        <span className="db-stat-label">Total Products</span>
                        <span className="db-stat-value">{totalCount.toLocaleString()}</span>
                        <span className="db-stat-sub">{selectedBranch || "All Branches"}</span>
                    </div>
                    <div className="db-stat-card">
                        <span className="db-stat-label">Total Value</span>
                        <span className="db-stat-value">₱{globalStats.totalValue.toLocaleString("en-PH", { minimumFractionDigits: 0 })}</span>
                        <span className="db-stat-sub">Estimated inventory value</span>
                    </div>
                    <div className="db-stat-card db-stat-warn">
                        <span className="db-stat-label">Low Stock</span>
                        <span className="db-stat-value">{globalStats.lowStock.toLocaleString()}</span>
                        <span className="db-stat-sub">Under {LOW_STOCK_THRESHOLD} units</span>
                    </div>
                    <div className="db-stat-card db-stat-danger">
                        <span className="db-stat-label">Out of Stock</span>
                        <span className="db-stat-value">{globalStats.outOfStock.toLocaleString()}</span>
                        <span className="db-stat-sub">Zero units on hand</span>
                    </div>
                </div>

                <div className="db-toolbar">
                    <div className="db-toolbar-left">
                        <div className="db-select-wrapper">
                            <IconFilter />
                            <select className="db-select" value={selectedBranch} onChange={(e) => { setSelectedBranch(e.target.value); setPage(1); }}>
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
                        <button className="db-refresh-btn" onClick={fetchInventory}><IconRefresh /> <span>Refresh</span></button>
                    </div>
                </div>

                <div className="db-table-wrap">
                    {loading ? (
                        <div className="db-loading"><div className="db-spinner" /><span>Loading data...</span></div>
                    ) : (
                        <table className="db-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Inventory ID</th>
                                    <th>Description</th>
                                    <th>Branch</th>
                                    <th>Site</th>
                                    <th className="db-num">On Hand</th>
                                    <th className="db-num">Available</th>
                                    <th className="db-num">Price</th>
                                    <th>Class</th>
                                    <th>Status</th>
                                    <th className="db-num">Qty Sold</th>
                                    <th className="db-num">Total Sales</th>
                                </tr>
                            </thead>
                            <tbody>
                                {allInventory.map((row, i) => (
                                    <InventoryRow
                                        key={i}
                                        row={row}
                                        index={(page - 1) * ROWS_PER_PAGE + i + 1}
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
        </div>
    );
}
