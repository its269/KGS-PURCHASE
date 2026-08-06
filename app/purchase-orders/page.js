"use client";

import { Fragment, useState, useEffect, useCallback, useRef, useMemo } from "react";
import { fetchWithAuth } from "@/lib/api-client";
import { withBasePath } from "@/lib/base-path";
import InventoryDetailModal from "@/components/InventoryDetailModal";
import "@/styles/dashboard.css";
import "@/styles/stock-items.css";
import "@/styles/po.css";
import "@/styles/inventory-detail.css";

const PAGE_SIZE = 10;

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
const IconFilter = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
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

function toDateKey(d) {
    if (!d) return "";
    const raw = String(d).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
    const date = new Date(raw);
    if (isNaN(date.getTime())) return "";
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

/** Today's date as ISO yyyy-mm-dd (local) */
function todayIso() {
    return toDateKey(new Date());
}

/** Display ISO / date value as yyyy/mm/dd */
function isoToYmd(d) {
    const key = toDateKey(d);
    if (!key) return "";
    const [y, m, day] = key.split("-");
    return `${y}/${m}/${day}`;
}

function fmtDate(d) {
    if (!d) return "—";
    return isoToYmd(d) || String(d);
}

function isValidYmdParts(year, month, day) {
    if (month < 1 || month > 12 || day < 1 || day > 31) return false;
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const check = new Date(`${iso}T12:00:00`);
    return !isNaN(check.getTime()) && check.getFullYear() === year && check.getMonth() + 1 === month && check.getDate() === day;
}

/** Parse yyyy/mm/dd (also yyyy-mm-dd / legacy mm/dd/yyyy) into ISO yyyy-mm-dd; null if invalid */
function ymdToIso(text) {
    const t = String(text || "").trim();
    if (!t) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;

    let match = t.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (match) {
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        if (!isValidYmdParts(year, month, day)) return null;
        return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }

    // Legacy mm/dd/yyyy
    match = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) return null;
    const month = Number(match[1]);
    const day = Number(match[2]);
    const year = Number(match[3]);
    if (!isValidYmdParts(year, month, day)) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Inclusive day count between two dates; null if incomplete/invalid */
function inclusiveDayCount(start, end) {
    const a = toDateKey(start);
    const b = toDateKey(end);
    if (!a || !b) return null;
    const startMs = new Date(`${a}T12:00:00`).getTime();
    const endMs = new Date(`${b}T12:00:00`).getTime();
    if (isNaN(startMs) || isNaN(endMs) || endMs < startMs) return null;
    return Math.floor((endMs - startMs) / 86400000) + 1;
}

function textIncludes(haystack, needle) {
    if (!needle) return true;
    return String(haystack ?? "").toLowerCase().includes(String(needle).toLowerCase().trim());
}

const EMPTY_COLUMN_FILTERS = {
    orderNbr: "",
    vendorId: "",
    vendorName: "",
    origin: "",
    status: "",
    containerNumber: "",
    date: "",
    etd: "",
    shipOutDate: "",
    eta: "",
    receivedDate: "",
    remarks: "",
    userStatus: "",
    totalAmount: "",
};

const COLUMN_FILTER_META = [
    { key: "orderNbr", label: "Order #" },
    { key: "vendorId", label: "Vendor ID" },
    { key: "vendorName", label: "Vendor Name" },
    { key: "origin", label: "Origin" },
    { key: "status", label: "Status" },
    { key: "containerNumber", label: "Container" },
    { key: "date", label: "PO Date" },
    { key: "etd", label: "ETD" },
    { key: "shipOutDate", label: "Ship Out" },
    { key: "eta", label: "ETA" },
    { key: "receivedDate", label: "Received" },
    { key: "remarks", label: "Remarks" },
    { key: "userStatus", label: "User Status" },
    { key: "totalAmount", label: "Amount" },
];

const PO_STATUS_FILTER_OPTIONS = [
    "Hold", "Open", "Balanced", "Pending Approval", "Completed", "Cancelled", "Closed",
];

const ORIGIN_OPTIONS = ["Philippines", "China"];

function PoDateInput({ value = "", onChange, className = "", style }) {
    const [text, setText] = useState(() => isoToYmd(value));
    const pickerRef = useRef(null);

    useEffect(() => {
        setText(isoToYmd(value));
    }, [value]);

    const commitText = (raw) => {
        const trimmed = String(raw || "").trim();
        if (!trimmed) {
            onChange?.("");
            setText("");
            return;
        }
        const iso = ymdToIso(trimmed);
        if (iso) {
            onChange?.(iso);
            setText(isoToYmd(iso));
        } else {
            setText(isoToYmd(value));
        }
    };

    return (
        <div className={`po-date-mdy ${className}`.trim()} style={style}>
            <input
                type="text"
                className="po-input-date po-input-date-mdy"
                placeholder="yyyy/mm/dd"
                inputMode="numeric"
                autoComplete="off"
                value={text}
                onChange={(e) => {
                    const next = e.target.value;
                    setText(next);
                    if (!next.trim()) {
                        onChange?.("");
                        return;
                    }
                    const iso = ymdToIso(next);
                    if (iso) onChange?.(iso);
                }}
                onBlur={() => commitText(text)}
            />
            <input
                ref={pickerRef}
                type="date"
                className="po-date-native-picker"
                value={toDateKey(value) || ""}
                onChange={(e) => onChange?.(e.target.value || "")}
                tabIndex={-1}
                aria-hidden="true"
            />
            <button
                type="button"
                className="po-date-picker-btn"
                aria-label="Open calendar"
                onClick={(e) => {
                    e.stopPropagation();
                    const el = pickerRef.current;
                    if (!el) return;
                    if (typeof el.showPicker === "function") el.showPicker();
                    else el.click();
                }}
            >
                <IconCalendar />
            </button>
        </div>
    );
}

function ColumnFilterHeader({
    label,
    filterKey,
    type = "text",
    value,
    options = [],
    onChange,
    className = "",
}) {
    const popoverId = `po-col-filter-${filterKey}`;
    const active = Boolean(value);

    return (
        <th className={className}>
            <div className="po-th-filter">
                <span className="po-th-label">{label}</span>
                <button
                    type="button"
                    className={`po-th-filter-btn ${active ? "active" : ""}`}
                    popoverTarget={popoverId}
                    aria-label={`Filter ${label}`}
                    onClick={(e) => e.stopPropagation()}
                >
                    <IconFilter />
                </button>
                <div
                    id={popoverId}
                    popover="auto"
                    className="po-col-filter-popover"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="po-col-filter-title">Filter: {label}</div>
                    {type === "select" ? (
                        <select
                            className="po-col-filter-input"
                            value={value || ""}
                            onChange={(e) => onChange(e.target.value)}
                        >
                            <option value="">All</option>
                            {options.map((opt) => (
                                <option key={opt} value={opt}>{opt}</option>
                            ))}
                        </select>
                    ) : type === "date" ? (
                        <PoDateInput
                            value={value || ""}
                            onChange={onChange}
                            className="po-col-filter-date"
                        />
                    ) : (
                        <input
                            type="text"
                            className="po-col-filter-input"
                            placeholder="Contains…"
                            value={value || ""}
                            onChange={(e) => onChange(e.target.value)}
                        />
                    )}
                    <div className="po-col-filter-actions">
                        <button type="button" className="po-col-filter-clear" onClick={() => onChange("")}>
                            Clear
                        </button>
                    </div>
                </div>
            </div>
        </th>
    );
}

const USER_STATUS_OPTIONS = ["Pending", "In Transit", "Arrived", "Customs", "Delayed", "Cancelled"];

const USER_STATUS_GUIDE = {
    "": {
        title: "No status selected",
        description: "Choose a user status to track shipment progress. Guidance for the selected status will appear here.",
    },
    Pending: {
        title: "Pending",
        description: "The order is confirmed but has not shipped yet. Verify ETA with the supplier and update the ETA field when a delivery date is available.",
        tips: ["Confirm production or packing status with the vendor.", "Enter Ship Out Date when goods leave the supplier.", "Set ETA once delivery schedule is confirmed."],
    },
    "In Transit": {
        title: "In Transit",
        description: "The shipment has left the supplier and is on the way. Keep container number and ETA up to date for warehouse receiving.",
        tips: ["Record the container or tracking reference.", "Keep Ship Out Date and ETA current if the schedule changes.", "Notify receiving team of the expected arrival window."],
    },
    Arrived: {
        title: "Arrived",
        description: "The shipment has reached the destination port or warehouse area. Prepare for unloading, inspection, or customs processing.",
        tips: ["Confirm actual arrival date against ETA.", "Coordinate with warehouse or logistics for receipt.", "Move to Customs if clearance is still required."],
    },
    Customs: {
        title: "Customs",
        description: "The shipment is undergoing customs clearance. Delays here can push back warehouse availability.",
        tips: ["Track broker or clearance documents.", "Update remarks with any hold reasons.", "Change to Arrived or Delayed if clearance completes or stalls."],
    },
    Delayed: {
        title: "Delayed",
        description: "The shipment is behind schedule versus the planned ETA. Document the reason and revised timeline in Remarks.",
        tips: ["Revise ETA to the new expected date.", "Note the cause of delay for supplier follow-up.", "Alert inventory planning if stock is at risk."],
    },
    Cancelled: {
        title: "Cancelled",
        description: "This order will not be fulfilled or received. Use this when the PO is voided, replaced, or abandoned in transit.",
        tips: ["Add remarks explaining why the order was cancelled.", "Confirm ERP status matches your tracking.", "Create a replacement PO if stock is still needed."],
    },
};

function UserStatusCell({ value, onChange }) {
    return (
        <select
            className="po-input-text po-user-status-select"
            value={value || ""}
            onChange={(e) => onChange(e.target.value)}
        >
            <option value="">— Select —</option>
            {USER_STATUS_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
            ))}
        </select>
    );
}

function UserStatusGuidePanel({ activeTab, onTabChange, onFilterTable, tableFilter }) {
    const guide = USER_STATUS_GUIDE[activeTab] || USER_STATUS_GUIDE.Pending;
    const isFiltering = tableFilter === activeTab;

    return (
        <section className="po-status-guide-panel" aria-labelledby="po-status-guide-title">
            <div className="po-status-guide-panel-head">
                <div className="po-status-guide-panel-icon">
                    <IconInfo />
                </div>
                <div>
                    <h2 id="po-status-guide-title">User Status Guide</h2>
                    <p>Tap a status to see what it means. Use Show in table to filter orders by that status.</p>
                </div>
            </div>

            <div className="po-status-guide-chips" role="tablist" aria-label="User status options">
                {USER_STATUS_OPTIONS.map((opt) => (
                    <button
                        key={opt}
                        type="button"
                        role="tab"
                        aria-selected={activeTab === opt}
                        className={`po-status-guide-chip ${activeTab === opt ? "active" : ""} ${tableFilter === opt ? "filtering" : ""}`}
                        onClick={() => onTabChange(opt)}
                    >
                        {opt}
                    </button>
                ))}
            </div>

            <div className="po-status-guide-body" role="tabpanel">
                <div className="po-status-guide-body-main">
                    <h3>{guide.title}</h3>
                    <p>{guide.description}</p>
                </div>
                {guide.tips?.length > 0 && (
                    <ul className="po-status-guide-tips">
                        {guide.tips.map((tip) => (
                            <li key={tip}>{tip}</li>
                        ))}
                    </ul>
                )}
            </div>

            <div className="po-status-guide-actions">
                <button
                    type="button"
                    className={`po-status-filter-table-btn ${isFiltering ? "active" : ""}`}
                    onClick={() => onFilterTable?.(isFiltering ? "" : activeTab)}
                >
                    {isFiltering ? `Clear “${activeTab}” filter` : `Show “${activeTab}” in table`}
                </button>
            </div>
        </section>
    );
}

export default function PurchaseOrdersPage() {
    const [orders, setOrders] = useState([]);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(false);
    const [search, setSearch] = useState("");
    const [debSearch, setDebSearch] = useState("");
    const [startDate, setStartDate] = useState(() => todayIso());
    const [endDate, setEndDate] = useState(() => todayIso());
    const [status, setStatus] = useState("Open");
    const [selectedBranch, setSelectedBranch] = useState("");
    const [branchOptions, setBranchOptions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [expanded, setExpanded] = useState({}); // orderNbr -> bool
    const [selectedId, setSelectedId] = useState(null);
    const [userInputs, setUserInputs] = useState({}); // key -> { eta, userStatus }
    const [statusGuideTab, setStatusGuideTab] = useState(USER_STATUS_OPTIONS[0]);
    const [userStatusTableFilter, setUserStatusTableFilter] = useState("");
    const [columnFilters, setColumnFilters] = useState(EMPTY_COLUMN_FILTERS);
    const [exporting, setExporting] = useState(false);

    const setColumnFilter = useCallback((field, value) => {
        const next = value || "";
        setColumnFilters((prev) => ({ ...prev, [field]: next }));
        if (field === "userStatus") {
            setUserStatusTableFilter(next);
            if (next && USER_STATUS_OPTIONS.includes(next)) {
                setStatusGuideTab(next);
            }
        }
    }, []);

    const clearAllColumnFilters = useCallback(() => {
        setColumnFilters(EMPTY_COLUMN_FILTERS);
        setUserStatusTableFilter("");
    }, []);

    const handleUserStatusTableFilter = useCallback((statusValue) => {
        const next = statusValue || "";
        setUserStatusTableFilter(next);
        setColumnFilters((prev) => ({ ...prev, userStatus: next }));
        if (next && USER_STATUS_OPTIONS.includes(next)) {
            setStatusGuideTab(next);
        }
    }, []);

    const activeColumnFilterChips = useMemo(
        () => COLUMN_FILTER_META.filter((col) => columnFilters[col.key]),
        [columnFilters]
    );

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
        const savedStatus = localStorage.getItem("po_filter_status");
        const savedBranch = localStorage.getItem("po_filter_branch") || "";
        const today = todayIso();

        Promise.resolve().then(async () => {
            // 1. Load filters — From/To always default to current date
            if (savedPage) setPage(parseInt(savedPage));
            if (savedSearch) setSearch(savedSearch);
            setStartDate(today);
            setEndDate(today);
            if (savedStatus) setStatus(savedStatus);
            if (savedBranch) setSelectedBranch(savedBranch);

            // Annotations only — list data always comes live from MySQL via /api/po
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
            localStorage.setItem("po_filter_endDate", endDate);
            localStorage.setItem("po_filter_status", status);
            localStorage.setItem("po_filter_branch", selectedBranch);
        }
    }, [page, search, startDate, endDate, status, selectedBranch]);

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
    }, [debSearch, startDate, endDate, status, selectedBranch]);

    const fetchOrders = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({
                page: String(page),
                pageSize: String(PAGE_SIZE),
                startDate: startDate,
                endDate: endDate,
                status: status
            });
            if (debSearch) params.set("search", debSearch);
            if (selectedBranch) params.set("branch", selectedBranch);

            const res = await fetchWithAuth(`/api/po?${params}`); 
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.message || `HTTP ${res.status}`);
            }
            const data = await res.json();
            setOrders(data.orders ?? []);
            setHasMore(data.hasMore ?? false);
        } catch (err) {
            if (err.message === "Unauthorized") return;
            setError(err.message || "Failed to load purchase orders.");
        } finally {
            setLoading(false);
        }
    }, [page, debSearch, startDate, endDate, status, selectedBranch]);

    useEffect(() => {
        fetchOrders();
    }, [fetchOrders]);

    const toggleExpand = (key) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

    const summaryStats = useMemo(() => {
        const totalValue = orders.reduce((sum, o) => sum + (Number(o.totalAmount) || 0), 0);
        const pendingEtaCount = orders.filter(o => !userInputs[`${o.orderType}-${o.orderNbr}`]?.eta).length;
        const openCount = orders.filter(o => o.status === 'Open').length;
        return { totalValue, pendingEtaCount, openCount };
    }, [orders, userInputs]);

    const rangeDayCount = useMemo(
        () => inclusiveDayCount(startDate, endDate),
        [startDate, endDate]
    );

    const displayedOrders = useMemo(() => {
        const f = columnFilters;
        return orders.filter((o) => {
            const key = `${o.orderType}-${o.orderNbr}`;
            const ui = userInputs[key] || {};

            if (!textIncludes(o.orderNbr, f.orderNbr)) return false;
            if (!textIncludes(o.vendorId, f.vendorId)) return false;
            if (!textIncludes(o.vendorName, f.vendorName)) return false;
            // ETD from Acumatica PromisedOn; fall back to legacy annotation if sync is empty
            const etdValue = o.promisedDate || ui.etd;
            if (f.origin && (ui.origin || "") !== f.origin) return false;
            if (f.status && String(o.status || "").toLowerCase() !== f.status.toLowerCase()) return false;
            if (!textIncludes(ui.containerNumber, f.containerNumber)) return false;
            if (f.date && toDateKey(o.date) !== f.date) return false;
            if (f.etd && toDateKey(etdValue) !== f.etd) return false;
            if (f.shipOutDate && toDateKey(ui.shipOutDate) !== f.shipOutDate) return false;
            if (f.eta && toDateKey(ui.eta) !== f.eta) return false;
            if (f.receivedDate && toDateKey(o.receiptDate) !== f.receivedDate) return false;
            if (!textIncludes(ui.remarks, f.remarks)) return false;
            if (f.userStatus && (ui.userStatus || "") !== f.userStatus) return false;
            if (f.totalAmount && !textIncludes(String(o.totalAmount ?? ""), f.totalAmount)
                && !textIncludes(fmt(o.totalAmount), f.totalAmount)) return false;
            return true;
        });
    }, [orders, userInputs, columnFilters]);

    return (
        <div className="po-root">
            <main className="po-main">
                <div className="db-page-title po-page-title-row">
                    <div className="po-page-title-text">
                        <h1>Purchase Orders</h1>
                        <p>View and manage all purchase orders live from Acumatica ERP.</p>
                    </div>
                    <UserStatusGuidePanel
                        activeTab={statusGuideTab}
                        onTabChange={setStatusGuideTab}
                        onFilterTable={handleUserStatusTableFilter}
                        tableFilter={userStatusTableFilter}
                    />
                </div>

                <aside className="po-summary-strip" aria-label="Purchase order summary">
                    <div className="po-summary-card">
                        <h3 className="po-summary-title">
                            <IconActivity /> Analytics Summary
                        </h3>

                        <div className="po-summary-grid">
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
                    </div>

                    <div className="po-info-box">
                        <h4 className="po-info-title">
                            <IconInfo /> Module Guide
                        </h4>
                        <p className="po-info-text">
                            PO Date, ETD (Promised On), and Received Date come from Acumatica / Purchase Receipts. Update Ship Out Date and ETA here for logistics tracking.
                        </p>
                        <p className="po-info-text" style={{ marginTop: '0.75rem' }}>
                            Changes to Ship Out Date, ETA, Container #, Remarks, Origin, and User Status are saved to your account and backed up locally. Use the User Status Guide to review each status and filter the table.
                        </p>
                    </div>
                </aside>

                {activeColumnFilterChips.length > 0 && (
                    <div className="po-column-filter-bar" role="status">
                        <div className="po-column-filter-chips">
                            {activeColumnFilterChips.map((col) => (
                                <button
                                    key={col.key}
                                    type="button"
                                    className="po-column-filter-chip"
                                    onClick={() => setColumnFilter(col.key, "")}
                                    title={`Clear ${col.label} filter`}
                                >
                                    <span>{col.label}:</span>
                                    <strong>{columnFilters[col.key]}</strong>
                                    <span aria-hidden="true">×</span>
                                </button>
                            ))}
                        </div>
                        <button type="button" className="po-column-filter-clear-all" onClick={clearAllColumnFilters}>
                            Clear all filters
                        </button>
                    </div>
                )}

                <div className="po-toolbar">
                    <div className="po-filter-group">
                        <span className="po-filter-label">From:</span>
                        <PoDateInput
                            value={startDate}
                            onChange={setStartDate}
                            style={{ width: "150px" }}
                        />
                    </div>

                    <div className="po-filter-group">
                        <span className="po-filter-label">To:</span>
                        <PoDateInput
                            value={endDate}
                            onChange={setEndDate}
                            style={{ width: "150px" }}
                        />
                    </div>

                    {rangeDayCount != null && (
                        <div className="po-filter-group po-filter-day-count" title="Inclusive days in selected range">
                            <span className="po-filter-label">Days:</span>
                            <span className="po-day-count-value">{rangeDayCount}</span>
                        </div>
                    )}

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
                                type="button"
                                className="db-search-clear"
                                onClick={() => setSearch("")}
                                aria-label="Clear search"
                            >
                                ×
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

                <div className="db-table-wrap po-table-wrap">
                    <table className="db-table po-table">
                        <thead>
                            <tr>
                                <th className="po-col-expand"></th>
                                <ColumnFilterHeader
                                    label="Order #"
                                    filterKey="orderNbr"
                                    className="po-col-order"
                                    value={columnFilters.orderNbr}
                                    onChange={(v) => setColumnFilter("orderNbr", v)}
                                />
                                <ColumnFilterHeader
                                    label="Vendor ID"
                                    filterKey="vendorId"
                                    className="po-col-vendor-id"
                                    value={columnFilters.vendorId}
                                    onChange={(v) => setColumnFilter("vendorId", v)}
                                />
                                <ColumnFilterHeader
                                    label="Vendor Name"
                                    filterKey="vendorName"
                                    className="po-col-vendor-name"
                                    value={columnFilters.vendorName}
                                    onChange={(v) => setColumnFilter("vendorName", v)}
                                />
                                <ColumnFilterHeader
                                    label="Origin"
                                    filterKey="origin"
                                    type="select"
                                    options={ORIGIN_OPTIONS}
                                    className="po-col-origin"
                                    value={columnFilters.origin}
                                    onChange={(v) => setColumnFilter("origin", v)}
                                />
                                <ColumnFilterHeader
                                    label="Status"
                                    filterKey="status"
                                    type="select"
                                    options={PO_STATUS_FILTER_OPTIONS}
                                    className="po-col-status"
                                    value={columnFilters.status}
                                    onChange={(v) => setColumnFilter("status", v)}
                                />
                                <ColumnFilterHeader
                                    label="Container"
                                    filterKey="containerNumber"
                                    className="po-col-container"
                                    value={columnFilters.containerNumber}
                                    onChange={(v) => setColumnFilter("containerNumber", v)}
                                />
                                <ColumnFilterHeader
                                    label="PO Date"
                                    filterKey="date"
                                    type="date"
                                    className="po-col-date"
                                    value={columnFilters.date}
                                    onChange={(v) => setColumnFilter("date", v)}
                                />
                                <ColumnFilterHeader
                                    label="ETD"
                                    filterKey="etd"
                                    type="date"
                                    className="po-col-etd"
                                    value={columnFilters.etd}
                                    onChange={(v) => setColumnFilter("etd", v)}
                                />
                                <ColumnFilterHeader
                                    label="Ship Out"
                                    filterKey="shipOutDate"
                                    type="date"
                                    className="po-col-ship-out"
                                    value={columnFilters.shipOutDate}
                                    onChange={(v) => setColumnFilter("shipOutDate", v)}
                                />
                                <ColumnFilterHeader
                                    label="ETA"
                                    filterKey="eta"
                                    type="date"
                                    className="po-col-eta"
                                    value={columnFilters.eta}
                                    onChange={(v) => setColumnFilter("eta", v)}
                                />
                                <ColumnFilterHeader
                                    label="Received"
                                    filterKey="receivedDate"
                                    type="date"
                                    className="po-col-received"
                                    value={columnFilters.receivedDate}
                                    onChange={(v) => setColumnFilter("receivedDate", v)}
                                />
                                <ColumnFilterHeader
                                    label="Remarks"
                                    filterKey="remarks"
                                    className="po-col-remarks"
                                    value={columnFilters.remarks}
                                    onChange={(v) => setColumnFilter("remarks", v)}
                                />
                                <ColumnFilterHeader
                                    label="User Status"
                                    filterKey="userStatus"
                                    type="select"
                                    options={USER_STATUS_OPTIONS}
                                    className="po-col-user-status"
                                    value={columnFilters.userStatus}
                                    onChange={(v) => setColumnFilter("userStatus", v)}
                                />
                                <ColumnFilterHeader
                                    label="Amount"
                                    filterKey="totalAmount"
                                    className="po-col-amount"
                                    value={columnFilters.totalAmount}
                                    onChange={(v) => setColumnFilter("totalAmount", v)}
                                />
                            </tr>
                        </thead>
                        <tbody>
                            {loading && orders.length === 0 ? (
                                <tr><td colSpan={15} className="si-loading-cell">
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', padding: '4rem 0' }}>
                                        <div className="db-spinner db-spinner-lg"></div>
                                        <span style={{ fontWeight: '600', color: 'var(--text-secondary)' }}>Fetching orders...</span>
                                    </div>
                                </td></tr>
                            ) : displayedOrders.length === 0 ? (
                                <tr><td colSpan={15} className="si-empty-cell" style={{ padding: '4rem 0' }}>
                                    {activeColumnFilterChips.length > 0
                                        ? "No purchase orders match the current column filters on this page."
                                        : "No purchase orders found."}
                                </td></tr>
                            ) : displayedOrders.map(po => {
                                const key = `${po.orderType}-${po.orderNbr}`;
                                const isOpen = !!expanded[key];
                                const ui = userInputs[key] || {};
                                const etdValue = po.promisedDate || ui.etd;
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
                                            <td onClick={(e) => e.stopPropagation()}>
                                                <select
                                                    className="po-input-text po-origin-select"
                                                    value={ui.origin || ""}
                                                    onChange={(e) => handleUserInput(key, "origin", e.target.value)}
                                                >
                                                    <option value="">— Select —</option>
                                                    <option value="Philippines">Philippines (Local)</option>
                                                    <option value="China">China</option>
                                                </select>
                                            </td>
                                            <td>
                                                <span className={`db-badge ${poStatusClass(po.status)}`}>{po.status || "—"}</span>
                                            </td>
                                            <td onClick={(e) => e.stopPropagation()}>
                                                <input
                                                    type="text"
                                                    className="po-input-text"
                                                    style={{ width: '100%' }}
                                                    placeholder="Container"
                                                    value={ui.containerNumber || ""}
                                                    onChange={(e) => handleUserInput(key, 'containerNumber', e.target.value)}
                                                />
                                            </td>
                                            <td>
                                                <span className="po-readonly-date">{fmtDate(po.date)}</span>
                                            </td>
                                            <td>
                                                <span className="po-readonly-date" title={po.promisedDate ? "From Acumatica Promised On" : (ui.etd ? "Legacy annotation" : "")}>
                                                    {fmtDate(etdValue)}
                                                </span>
                                            </td>
                                            <td onClick={(e) => e.stopPropagation()}>
                                                <PoDateInput
                                                    value={ui.shipOutDate || ""}
                                                    onChange={(val) => handleUserInput(key, "shipOutDate", val)}
                                                />
                                            </td>
                                            <td onClick={(e) => e.stopPropagation()}>
                                                <PoDateInput
                                                    value={ui.eta || ""}
                                                    onChange={(val) => handleUserInput(key, "eta", val)}
                                                />
                                            </td>
                                            <td>
                                                <span className="po-readonly-date" title={po.receiptDate ? "From Purchase Receipt" : ""}>
                                                    {fmtDate(po.receiptDate)}
                                                </span>
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
                                                <UserStatusCell
                                                    value={ui.userStatus || ""}
                                                    onChange={(val) => handleUserInput(key, "userStatus", val)}
                                                />
                                            </td>
                                            <td style={{ textAlign: "right" }}>
                                                <strong className="po-amount-cell">₱{fmt(po.totalAmount)}</strong>
                                            </td>
                                        </tr>
                                        {isOpen && (
                                            <tr className="po-lines-row">
                                                <td colSpan={15}>
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

            {selectedId && (
                <InventoryDetailModal inventoryId={selectedId} onClose={() => setSelectedId(null)} />
            )}
        </div>
    );
}
