"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { fetchWithAuth } from "@/lib/api-client";
import { withBasePath } from "@/lib/base-path";
import { DIMENSION_FIELDS } from "@/lib/item-dimensions";
import InventoryDetailModal from "@/components/InventoryDetailModal";
import PaginationBar from "@/components/PaginationBar";
import "@/styles/dashboard.css";
import "@/styles/stock-items.css";

const PAGE_SIZE = 10;

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
const IconInfo = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
);
const IconChevronDown = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9" />
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
    const [selectedItemClass, setSelectedItemClass] = useState("");
    const [itemClasses, setItemClasses] = useState([]);
    const [dimsStatus, setDimsStatus] = useState(""); // '' | 'set' | 'unset'
    const [dimsSetCount, setDimsSetCount] = useState(0);
    const [dimsUnsetCount, setDimsUnsetCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selectedId, setSelectedId] = useState(null);
    const [exporting, setExporting] = useState(false);
    const [importing, setImporting] = useState(false);
    const [importMsg, setImportMsg] = useState(null);
    const [importProgress, setImportProgress] = useState(0);
    const [importStatus, setImportStatus] = useState("");
    const [importError, setImportError] = useState(false);
    const [showImportInfo, setShowImportInfo] = useState(false);
    const [companyLabel, setCompanyLabel] = useState("Main Company");
    const fileInputRef = useRef(null);
    const importInfoRef = useRef(null);

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

    const handleImportDimensions = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setImporting(true);
        setImportMsg(null);
        setImportError(false);
        setImportProgress(5);
        setImportStatus("Reading file…");
        try {
            const XLSX = await import("xlsx");
            setImportProgress(20);
            const buffer = await file.arrayBuffer();
            const workbook = XLSX.read(buffer, { type: "array" });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
            const rowCount = rows.length;
            setImportProgress(35);
            setImportStatus(rowCount > 0
                ? `Found ${rowCount.toLocaleString()} row${rowCount === 1 ? "" : "s"}. Uploading…`
                : "Uploading file…");

            const form = new FormData();
            form.append("file", file);
            setImportProgress(50);
            setImportStatus("Importing dimensions…");

            const res = await fetchWithAuth("/api/stock-items/dimensions/import", {
                method: "POST",
                body: form,
            });
            setImportProgress(85);
            setImportStatus("Saving to database…");

            const data = await res.json();
            if (!res.ok) throw new Error(data.message || "Import failed");

            setImportProgress(100);
            setImportStatus("Import complete");
            setImportMsg(data.message);
            fetchItems();
        } catch (err) {
            if (err.message !== "Unauthorized") {
                setImportError(true);
                setImportMsg(err.message || "Import failed");
                setImportStatus("Import failed");
            }
        } finally {
            setTimeout(() => {
                setImporting(false);
                setImportProgress(0);
                setImportStatus("");
            }, 1200);
            e.target.value = "";
        }
    };

    useEffect(() => {
        if (!showImportInfo) return;
        const onDocClick = (ev) => {
            if (importInfoRef.current && !importInfoRef.current.contains(ev.target)) {
                setShowImportInfo(false);
            }
        };
        document.addEventListener("mousedown", onDocClick);
        return () => document.removeEventListener("mousedown", onDocClick);
    }, [showImportInfo]);

    useEffect(() => {
        const loadCompany = () => {
            fetchWithAuth("/api/company")
                .then((res) => (res.ok ? res.json() : null))
                .then((data) => {
                    if (!data) return;
                    const active = data.companies?.find((c) => c.id === data.activeCompanyId);
                    setCompanyLabel(active?.label || "Main Company");
                })
                .catch(() => {});
        };
        loadCompany();
        const onCompanyChange = () => {
            setPage(1);
            setItems([]);
            loadCompany();
        };
        window.addEventListener("company-changed", onCompanyChange);
        return () => window.removeEventListener("company-changed", onCompanyChange);
    }, []);

    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(search), 300);
        return () => clearTimeout(t);
    }, [search]);

    useEffect(() => {
        Promise.resolve().then(() => setPage(1));
    }, [debouncedSearch, selectedItemClass, dimsStatus]);

    const handleItemClassChange = (value) => {
        setSelectedItemClass(value);
        setPage(1);
        setSelectedId(null);
    };

    const handleDimsStatusChange = (value) => {
        setDimsStatus(value === "set" || value === "unset" ? value : "");
        setPage(1);
        setSelectedId(null);
    };

    const fetchItems = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
            if (debouncedSearch) params.set("search", debouncedSearch);
            if (selectedItemClass) params.set("itemClass", selectedItemClass);
            if (dimsStatus) params.set("dimsStatus", dimsStatus);

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
            setDimsSetCount(Number(data.dimsSetCount) || 0);
            setDimsUnsetCount(Number(data.dimsUnsetCount) || 0);
            if (Array.isArray(data.itemClasses)) {
                setItemClasses(data.itemClasses);
            }
        } catch (err) {
            if (err.message === "Unauthorized") return;
            setError(err.message || "Failed to load stock items. Please try again.");
        } finally {
            setLoading(false);
        }
    }, [page, debouncedSearch, selectedItemClass, dimsStatus]);

    useEffect(() => {
        fetchItems();
    }, [fetchItems]);

    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

    return (
        <div className="db-root si-page">
            <main className="db-main si-main">
                <header className="si-hero" data-tour="page-title">
                    <div className="si-hero-top">
                        <div className="si-hero-copy">
                            <p className="si-eyebrow">Product catalog</p>
                            <h1 className="si-title">Stock Items Masterlist</h1>
                            <p className="si-subtitle">
                                Browse products and configurations. Select a row for branch availability.
                            </p>
                        </div>
                        <div className="si-hero-meta" aria-label="Data context">
                            <span className="si-chip si-chip-company">{companyLabel}</span>
                            <span
                                className={`si-chip ${
                                    dataSource.includes("acumatica")
                                        ? "si-chip-warn"
                                        : "si-chip-live"
                                }`}
                            >
                                <span className="si-chip-dot" aria-hidden="true" />
                                {dataSource === "mysql" || dataSource === "mysql-catalog"
                                    ? "Live from MySQL"
                                    : dataSource === "acumatica-fallback"
                                    ? "Fallback: Live ERP"
                                    : "Live from ERP"}
                            </span>
                        </div>
                    </div>

                    <div className="si-metrics" role="group" aria-label="Catalog totals" data-tour="kpi-cards">
                        <div className="si-metric">
                            <span className="si-metric-label">Product types</span>
                            <span className="si-metric-value">
                                {loading && totalCount === 0
                                    ? "…"
                                    : (totalCount || 0).toLocaleString()}
                            </span>
                            <span className="si-metric-hint">
                                {dimsStatus === "set"
                                    ? "With dimensions set"
                                    : dimsStatus === "unset"
                                    ? "Without dimensions"
                                    : selectedItemClass
                                    ? `In ${selectedItemClass}`
                                    : "Distinct inventory IDs"}
                            </span>
                        </div>
                        <div className="si-metric si-metric-accent">
                            <span className="si-metric-label">On-hand stock</span>
                            <span className="si-metric-value">
                                {loading && totalStock === 0
                                    ? "…"
                                    : (totalStock || 0).toLocaleString()}
                            </span>
                            <span className="si-metric-hint">
                                {selectedItemClass
                                    ? `Warehouse units for ${selectedItemClass}`
                                    : "Sum of all warehouse units"}
                            </span>
                        </div>
                        <button
                            type="button"
                            className={`si-metric si-metric-btn si-metric-dims-set${dimsStatus === "set" ? " is-active" : ""}`}
                            onClick={() => handleDimsStatusChange(dimsStatus === "set" ? "" : "set")}
                            aria-pressed={dimsStatus === "set"}
                            title={dimsStatus === "set" ? "Show all items again" : "Show only items with dimensions set"}
                        >
                            <span className="si-metric-label">Dims set</span>
                            <span className="si-metric-value">
                                {loading && dimsSetCount === 0 && dimsUnsetCount === 0
                                    ? "…"
                                    : dimsSetCount.toLocaleString()}
                            </span>
                            <span className="si-metric-hint">
                                {dimsStatus === "set" ? "Showing set only — click to show all" : "Click to show only set"}
                            </span>
                        </button>
                        <button
                            type="button"
                            className={`si-metric si-metric-btn si-metric-dims-unset${dimsStatus === "unset" ? " is-active" : ""}`}
                            onClick={() => handleDimsStatusChange(dimsStatus === "unset" ? "" : "unset")}
                            aria-pressed={dimsStatus === "unset"}
                            title={dimsStatus === "unset" ? "Show all items again" : "Show only items without dimensions"}
                        >
                            <span className="si-metric-label">Dims not set</span>
                            <span className="si-metric-value">
                                {loading && dimsSetCount === 0 && dimsUnsetCount === 0
                                    ? "…"
                                    : dimsUnsetCount.toLocaleString()}
                            </span>
                            <span className="si-metric-hint">
                                {dimsStatus === "unset" ? "Showing unset only — click to show all" : "Click to show only unset"}
                            </span>
                        </button>
                    </div>
                </header>

                <div className="si-toolbar" data-tour="toolbar">
                    <div className="si-toolbar-left">
                    <div className="si-class-wrap" data-tour="item-class-filter">
                        <select
                            className="si-class-select"
                            value={selectedItemClass}
                            onChange={(e) => handleItemClassChange(e.target.value)}
                            aria-label="Item class filter"
                        >
                            <option value="">All Item Classes</option>
                            {itemClasses.map((cls) => (
                                <option key={cls} value={cls}>
                                    {cls}
                                </option>
                            ))}
                        </select>
                        <IconChevronDown />
                    </div>
                    <div className="si-class-wrap" data-tour="dims-status-filter">
                        <select
                            className="si-class-select"
                            value={dimsStatus}
                            onChange={(e) => handleDimsStatusChange(e.target.value)}
                            aria-label="Dimensions status filter"
                        >
                            <option value="">All dims status</option>
                            <option value="set">Dims set</option>
                            <option value="unset">Dims not set</option>
                        </select>
                        <IconChevronDown />
                    </div>
                    <div className="si-search-wrap">
                        <IconSearch />
                        <input
                            className="si-search"
                            type="search"
                            placeholder="Search by ID or description…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            aria-label="Search stock items"
                        />
                        {search ? (
                            <button
                                type="button"
                                className="si-search-clear"
                                onClick={() => setSearch("")}
                                aria-label="Clear search"
                            >
                                ×
                            </button>
                        ) : null}
                    </div>
                    </div>

                    <div className="si-actions">
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".xlsx,.xls,.csv"
                            style={{ display: "none" }}
                            onChange={handleImportDimensions}
                        />
                        <div className="si-import-group" ref={importInfoRef}>
                            <button
                                type="button"
                                className="si-btn si-btn-ghost"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={importing}
                            >
                                {importing ? "Importing…" : "Import dimensions"}
                            </button>
                            <button
                                type="button"
                                className="si-icon-btn"
                                aria-label="Import file format requirements"
                                aria-expanded={showImportInfo}
                                onClick={() => setShowImportInfo((v) => !v)}
                                disabled={importing}
                            >
                                <IconInfo />
                            </button>
                            {showImportInfo && (
                                <div className="si-import-info-panel" role="dialog" aria-label="Import format guide">
                                    <strong>Required file format</strong>
                                    <p>
                                        Upload an Excel (.xlsx, .xls) or CSV file with a header row. The
                                        first column must match stock items by Inventory ID.
                                    </p>
                                    <ul>
                                        <li>
                                            <strong>Inventory ID</strong> — must match an existing stock
                                            item
                                        </li>
                                        {DIMENSION_FIELDS.map((f) => (
                                            <li key={f.key}>
                                                <strong>{f.label}</strong> — optional numeric value
                                            </li>
                                        ))}
                                    </ul>
                                    <p className="si-import-info-note">
                                        Unknown Inventory IDs are skipped. Existing dimension values are
                                        not overwritten — only empty fields are filled.
                                    </p>
                                </div>
                            )}
                        </div>

                        <button
                            type="button"
                            className="si-btn si-btn-secondary"
                            onClick={handleExport}
                            disabled={exporting}
                        >
                            <IconDownload /> {exporting ? "Exporting…" : "Export CSV"}
                        </button>

                        <button
                            type="button"
                            className="si-btn si-btn-primary"
                            onClick={() => fetchItems()}
                            disabled={loading}
                        >
                            {loading && (
                                <span
                                    className="db-spinner"
                                    style={{
                                        width: "14px",
                                        height: "14px",
                                        borderWidth: "2px",
                                        borderTopColor: "currentColor",
                                    }}
                                />
                            )}
                            <span>{loading ? "Refreshing…" : "Refresh"}</span>
                        </button>
                    </div>
                </div>

                {importing && (
                    <div className="si-import-progress" role="status" aria-live="polite">
                        <div className="si-import-progress-header">
                            <div className="db-spinner" style={{ width: "16px", height: "16px", borderWidth: "2px" }} />
                            <span>{importStatus || "Importing…"}</span>
                            <span className="si-import-progress-pct">{importProgress}%</span>
                        </div>
                        <div className="si-import-progress-track">
                            <div
                                className="si-import-progress-bar"
                                style={{ width: `${importProgress}%` }}
                            />
                        </div>
                    </div>
                )}

                {importMsg && !importing && (
                    <div className={`si-import-msg ${importError ? "si-import-msg-error" : ""}`}>
                        {importMsg}
                    </div>
                )}

                {error && <div className="si-error">{error}</div>}

                <div className="si-table-panel" data-tour="main-table">
                    <div className="si-table-scroll">
                        <table className="si-table">
                            <thead>
                                <tr>
                                    <th className="si-col-id">Inventory ID</th>
                                    <th className="si-col-desc">Description</th>
                                    <th className="si-col-class">Item class</th>
                                    <th className="si-col-num">MOQ</th>
                                    <th className="si-col-num">Price</th>
                                    <th className="si-col-unit">Unit</th>
                                    <th className="si-col-status">Status</th>
                                    <th className="si-col-dim">Dims</th>
                                    <th className="si-col-action">
                                        <span className="si-sr-only">Action</span>
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading && items.length === 0 ? (
                                    <tr>
                                        <td colSpan={9} className="si-loading-cell">
                                            <div className="si-empty-state">
                                                <div className="db-spinner db-spinner-lg" />
                                                <span>Fetching items…</span>
                                            </div>
                                        </td>
                                    </tr>
                                ) : items.length === 0 ? (
                                    <tr>
                                        <td colSpan={9} className="si-empty-cell">
                                            <div className="si-empty-state">
                                                <strong>No matching items</strong>
                                                <span>Try a different search term or clear filters.</span>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    items.map((item) => {
                                        const active =
                                            String(item.itemStatus || "").toLowerCase() === "active";
                                        const onHand = Number(item.totalOnHand) || 0;
                                        const stockTone =
                                            onHand <= 0 ? "out" : onHand < 10 ? "low" : "ok";
                                        return (
                                            <tr
                                                key={item.inventoryId}
                                                className={`si-row ${
                                                    selectedId === item.inventoryId
                                                        ? "si-row-selected"
                                                        : ""
                                                }`}
                                                onClick={() => setSelectedId(item.inventoryId)}
                                            >
                                                <td className="si-col-id">
                                                    <span className="si-inv-id">{item.inventoryId}</span>
                                                </td>
                                                <td className="si-col-desc">
                                                    <span className="si-desc" title={item.description}>
                                                        {item.description || "—"}
                                                    </span>
                                                </td>
                                                <td className="si-col-class">
                                                    {item.itemClass ? (
                                                        <span className="si-class">{item.itemClass}</span>
                                                    ) : (
                                                        <span className="si-muted">—</span>
                                                    )}
                                                </td>
                                                <td className="si-col-num">
                                                    {item.moq != null && item.moq !== "" ? (
                                                        Number(item.moq).toLocaleString()
                                                    ) : (
                                                        <span className="si-muted">—</span>
                                                    )}
                                                </td>
                                                <td className="si-col-num si-price">
                                                    ₱{(Number(item.price) || 0).toLocaleString()}
                                                </td>
                                                <td className="si-col-unit">
                                                    {item.baseUnit || <span className="si-muted">—</span>}
                                                </td>
                                                <td className="si-col-status">
                                                    <div className="si-status-stack">
                                                        <span
                                                            className={`si-status-pill ${
                                                                active ? "is-active" : "is-inactive"
                                                            }`}
                                                        >
                                                            {item.itemStatus || "—"}
                                                        </span>
                                                        {stockTone !== "ok" ? (
                                                            <span
                                                                className={`si-stock-flag is-${stockTone}`}
                                                            >
                                                                {stockTone === "out"
                                                                    ? "Out of stock"
                                                                    : "Low stock"}
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                </td>
                                                <td className="si-col-dim">
                                                    {item.hasDimensions ? (
                                                        <span className="si-dim-badge is-set">Set</span>
                                                    ) : (
                                                        <span className="si-dim-badge is-unset">Not set</span>
                                                    )}
                                                </td>
                                                <td className="si-col-action">
                                                    <button
                                                        type="button"
                                                        className="si-row-action"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setSelectedId(item.inventoryId);
                                                        }}
                                                    >
                                                        View
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {!loading && totalCount > 0 && (
                    <PaginationBar
                        page={page}
                        pageSize={PAGE_SIZE}
                        totalCount={totalCount}
                        onPageChange={setPage}
                        itemLabel="items"
                    />
                )}
            </main>

            {selectedId && (
                <InventoryDetailModal inventoryId={selectedId} onClose={() => setSelectedId(null)} />
            )}
        </div>
    );
}
