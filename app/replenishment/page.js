"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { DataCache } from "@/lib/data-cache";
import { LIST_CACHE_FRESH_MS } from "@/lib/list-cache";
import { fetchWithAuth } from "@/lib/api-client";
import { buildReplenishmentInsight, TARGET_DAYS_OF_COVER } from "@/lib/replenishment-insights";
import "@/styles/dashboard.css";
import "@/styles/inventory-detail.css";
import "@/styles/replenishment.css";

const PAGE_SIZE = 10;

const IconSearch = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
);
const IconChevronRight = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 18 15 12 9 6" />
    </svg>
);
const IconChevronLeft = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15 18 9 12 15 6" />
    </svg>
);
const IconChevron = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9" />
    </svg>
);
const IconSparkles = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    </svg>
);
const IconInfo = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
);
const IconDownload = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
    </svg>
);
const IconClose = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
);

function ColumnInfoHeader({ label, panelId, openId, setOpenId, align = "left", children }) {
    const open = openId === panelId;
    const wrapRef = useRef(null);
    const btnRef = useRef(null);
    const [panelPos, setPanelPos] = useState(null);

    const updatePanelPos = useCallback(() => {
        if (!btnRef.current) return;
        const rect = btnRef.current.getBoundingClientRect();
        const panelWidth = Math.min(360, window.innerWidth - 24);
        let left = align === "right" ? rect.right - panelWidth : rect.left;
        left = Math.max(12, Math.min(left, window.innerWidth - panelWidth - 12));
        setPanelPos({
            top: rect.bottom + 6,
            left,
            width: panelWidth,
        });
    }, [align]);

    useEffect(() => {
        if (!open) {
            setPanelPos(null);
            return;
        }
        updatePanelPos();
        window.addEventListener("resize", updatePanelPos);
        window.addEventListener("scroll", updatePanelPos, true);
        return () => {
            window.removeEventListener("resize", updatePanelPos);
            window.removeEventListener("scroll", updatePanelPos, true);
        };
    }, [open, updatePanelPos]);

    useEffect(() => {
        if (!open) return;
        const onDocClick = (ev) => {
            if (wrapRef.current && !wrapRef.current.contains(ev.target)) {
                setOpenId(null);
            }
        };
        document.addEventListener("mousedown", onDocClick);
        return () => document.removeEventListener("mousedown", onDocClick);
    }, [open, setOpenId]);

    return (
        <span className={`repl-col-head ${align === "right" ? "repl-col-head-right" : ""}`}>
            <span className="repl-col-head-label">{label}</span>
            <span className="repl-col-info-wrap" ref={wrapRef}>
                <button
                    ref={btnRef}
                    type="button"
                    className="repl-col-info-btn"
                    aria-label={`How ${label} is calculated`}
                    aria-expanded={open}
                    onClick={(e) => {
                        e.stopPropagation();
                        setOpenId(open ? null : panelId);
                    }}
                >
                    <IconInfo />
                </button>
                {open && panelPos && (
                    <div
                        className="repl-col-info-panel repl-col-info-panel-fixed"
                        role="dialog"
                        style={{
                            top: panelPos.top,
                            left: panelPos.left,
                            width: panelPos.width,
                        }}
                    >
                        {children}
                    </div>
                )}
            </span>
        </span>
    );
}

function priorityLabel(level) {
    if (level === "High") return "Urgent";
    if (level === "Medium") return "Soon";
    return "Low";
}

function priorityClass(level) {
    if (level === "High") return "repl-status-urgent";
    if (level === "Medium") return "repl-status-soon";
    return "repl-status-low";
}

function fmtNum(n) {
    const val = Number(n);
    if (Number.isNaN(val)) return "—";
    return val % 1 === 0 ? val.toLocaleString() : val.toFixed(1);
}

/** Cache often serves slim rows without howItWorks.steps — rebuild so Explain always has content. */
function resolveAiInsights(rec) {
    const existing = rec?.aiInsights || {};
    if (existing.howItWorks?.steps?.length && existing.headline && existing.summary) {
        return existing;
    }

    const ads = Number(existing.salesVelocity) || 0;
    const rawDays = existing.daysRemaining;
    const hasSalesHistory = rawDays !== "N/A" && rawDays != null && ads > 0;
    const daysRemaining = hasSalesHistory ? Number(rawDays) || 0 : 0;
    const currentStock = Number(rec.currentStock ?? rec.mainInventory) || 0;
    const suggestedQty = Number(rec.suggestedQty) || 0;
    const branchId = rec.branchId || (rec.isMainWarehouseView ? "MAIN" : "");
    const rebuilt = buildReplenishmentInsight({
        itemId: rec.itemId,
        description: rec.description,
        currentStock,
        suggestedQty,
        priorityLevel: rec.priorityLevel || "Low",
        branchId,
        ads,
        daysRemaining,
        leadTimeDays: rec.leadTimeDays ?? existing.leadTimeDays ?? 0,
        vendorId: rec.vendorId || existing.vendorId || null,
        hasSalesHistory,
        qtySold90: Number(rec.qtySold90) || 0,
        targetStock: ads * TARGET_DAYS_OF_COVER,
        salesScope: rec.salesScope || existing.salesScope || "branch",
        mainWarehouseContext: rec.isMainWarehouseView
            ? {
                branchOrderQty: Number(rec.branchOrderQty) || 0,
                comingPO: Number(rec.comingPO) || 0,
                totalBranchReplenishment: Number(rec.totalBranchReplenishment) || 0,
            }
            : null,
    });

    return {
        ...rebuilt,
        ...existing,
        headline: existing.headline || rebuilt.headline,
        summary: existing.summary || rebuilt.summary,
        whatToDo: existing.whatToDo || rebuilt.whatToDo,
        formula: existing.formula || rebuilt.formula,
        metrics: existing.metrics?.length ? existing.metrics : rebuilt.metrics,
        howItWorks: {
            preview: existing.howItWorks?.preview || rebuilt.howItWorks.preview,
            steps: existing.howItWorks?.steps?.length
                ? existing.howItWorks.steps
                : rebuilt.howItWorks.steps,
        },
    };
}

function AiExplainLightbox({ rec, onClose }) {
    useEffect(() => {
        if (!rec) return undefined;
        const onKey = (e) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", onKey);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.removeEventListener("keydown", onKey);
            document.body.style.overflow = prevOverflow;
        };
    }, [rec, onClose]);

    if (!rec) return null;

    const ai = resolveAiInsights(rec);
    const how = ai.howItWorks || {};
    const steps = how.steps || [];
    const explanation = [ai.headline, ai.summary].filter(Boolean).join(" — ")
        || how.preview
        || ai.message
        || "";

    return (
        <div className="idm-overlay" onClick={onClose} role="presentation">
            <div
                className="idm-modal repl-ai-lightbox"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="repl-ai-lightbox-title"
            >
                <button type="button" className="idm-close-btn" onClick={onClose} aria-label="Close">
                    <IconClose />
                </button>

                <div className="idm-content repl-ai-lightbox-content">
                    <div className="repl-ai-lightbox-header">
                        <div className="repl-ai-lightbox-icon">
                            <IconSparkles />
                        </div>
                        <div>
                            <h2 id="repl-ai-lightbox-title">AI Explanation</h2>
                            <p>
                                <span className="repl-product-id">{rec.itemId}</span>
                                {rec.description ? ` · ${rec.description}` : ""}
                            </p>
                        </div>
                    </div>

                    {explanation && (
                        <section className="repl-ai-lightbox-section">
                            <h3>Explanation</h3>
                            <p className="repl-ai-lightbox-preview">{explanation}</p>
                        </section>
                    )}

                    {(ai.whatToDo || rec.restockSource) && (
                        <section className="repl-ai-lightbox-section">
                            <h3>Recommended action</h3>
                            <p>{ai.whatToDo || rec.restockSource}</p>
                        </section>
                    )}

                    {ai.formula && (
                        <section className="repl-ai-lightbox-section">
                            <h3>Formula</h3>
                            <p className="repl-ai-lightbox-formula">{ai.formula}</p>
                        </section>
                    )}

                    {ai.metrics?.length > 0 && (
                        <section className="repl-ai-lightbox-section">
                            <h3>Key figures</h3>
                            <ul className="repl-ai-metrics">
                                {ai.metrics.map((m) => (
                                    <li key={m.label}>
                                        <strong>{m.label}</strong>
                                        <span>{m.value}</span>
                                        {m.hint ? <em>{m.hint}</em> : null}
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}

                    <section className="repl-ai-lightbox-section">
                        <h3>How it was calculated</h3>
                        {steps.length > 0 ? (
                            <ol className="repl-ai-steps">
                                {steps.map((step) => (
                                    <li key={step.title}>
                                        <strong>{step.title}</strong>
                                        <p>{step.text}</p>
                                    </li>
                                ))}
                            </ol>
                        ) : (
                            <p className="repl-ai-lightbox-empty">
                                No detailed steps for this row — stock is sufficient or no order is suggested.
                            </p>
                        )}
                    </section>
                </div>
            </div>
        </div>
    );
}

function ReplenishmentRows({ recs, onExplain, explainId, isMain }) {
    return recs.map((rec) => {
        const ai = rec.aiInsights || {};
        const how = ai.howItWorks || {};
        const days = ai.daysRemaining;
        const ads = ai.salesVelocity;
        const hasSales = days !== "N/A" && days != null;
        const isOpen = explainId === rec.recommendationId;
        const leadTime = rec.leadTimeDays ?? ai.leadTimeDays;

        return (
            <tr key={rec.recommendationId} className={`repl-row ${priorityClass(rec.priorityLevel)}`}>
                <td>
                    <span className={`repl-badge ${priorityClass(rec.priorityLevel)}`}>
                        {priorityLabel(rec.priorityLevel)}
                    </span>
                </td>
                <td>
                    <div className="repl-product-id">{rec.itemId}</div>
                    <div className="repl-product-desc">{rec.description || "—"}</div>
                </td>
                {isMain ? (
                    <>
                        <td className="repl-num">{fmtNum(rec.branchOrderQty ?? 0)}</td>
                        <td className="repl-num">{fmtNum(rec.mainInventory ?? rec.currentStock)}</td>
                        <td className="repl-num">{fmtNum(rec.comingPO ?? 0)}</td>
                        <td className="repl-num">{fmtNum(rec.totalBranchReplenishment ?? rec.branchOrderQty ?? 0)}</td>
                    </>
                ) : (
                    <>
                        <td className="repl-num">{fmtNum(rec.currentStock)}</td>
                        <td className="repl-num">{fmtNum(rec.comingPO ?? 0)}</td>
                    </>
                )}
                <td className="repl-num">{hasSales ? fmtNum(ads) : "—"}</td>
                <td className="repl-num">{hasSales ? `${fmtNum(days)} days` : "—"}</td>
                <td className="repl-num">{leadTime > 0 ? `${fmtNum(leadTime)} days` : "—"}</td>
                <td className="repl-num repl-order-qty">
                    {Number(rec.suggestedQty) > 0 ? `+${fmtNum(rec.suggestedQty)}` : fmtNum(rec.suggestedQty ?? 0)}
                </td>
                <td className="repl-action">{ai.whatToDo || rec.restockSource}</td>
                <td className="repl-ai-cell">
                    <p className="repl-ai-preview">{how.preview || "Tap Explain to see how this was calculated."}</p>
                    <button
                        type="button"
                        className={`repl-ai-btn ${isOpen ? "open" : ""}`}
                        onClick={() => onExplain(rec)}
                        aria-haspopup="dialog"
                        aria-expanded={isOpen}
                    >
                        <IconSparkles />
                        Explain
                    </button>
                </td>
            </tr>
        );
    });
}

export default function ReplenishmentPage() {
    const [recs, setRecs] = useState([]);
    const [brief, setBrief] = useState(null);
    const [meta, setMeta] = useState(null);
    const [branches, setBranches] = useState([]);
    const [viewMode, setViewMode] = useState("main");
    const [selectedBranch, setSelectedBranch] = useState("");
    const [priorityFilter, setPriorityFilter] = useState("all");
    const [search, setSearch] = useState("");
    const [loading, setLoading] = useState(true);
    const [backgroundLoading, setBackgroundLoading] = useState(false);
    const [error, setError] = useState(null);
    const [aiExplainRec, setAiExplainRec] = useState(null);
    const [openColumnInfo, setOpenColumnInfo] = useState(null);
    const [page, setPage] = useState(1);
    const fetchGenRef = useRef(0);
    const closeAiExplain = useCallback(() => setAiExplainRec(null), []);

    const retailBranches = useMemo(
        () => branches.filter((b) => {
            const id = String(b.SiteID || b.branch_id || "").trim();
            return id && id !== "MAIN" && id !== "__catalog__";
        }),
        [branches]
    );

    const activeBranch = viewMode === "main" ? "MAIN" : selectedBranch;
    const isMain = viewMode === "main";

    const applyPayload = useCallback((data) => {
        const list = Array.isArray(data) ? data : (data?.recommendations ?? []);
        setRecs(list);
        setBrief(data?.brief ?? null);
        setMeta(data?.meta ?? null);
    }, []);

    const fetchRecommendations = useCallback(async (isBackground = false, branchToFetch = activeBranch, forceRefresh = false) => {
        if (!branchToFetch) return;
        const gen = ++fetchGenRef.current;
        if (!isBackground) setLoading(true);
        setError(null);

        const load = async (qs) => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 120000);
            const res = await fetchWithAuth(`/api/replenishment?branch=${encodeURIComponent(branchToFetch)}${qs}`, {
                signal: controller.signal,
            });
            clearTimeout(timeout);
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.message || `HTTP ${res.status}`);
            }
            return res.json();
        };

        try {
            const refreshParam = forceRefresh ? "&refresh=1" : "";

            // 1) Ultra-fast first paint: only 10 rows
            const first = await load(`&page=1&pageSize=${PAGE_SIZE}${refreshParam}`);
            if (gen !== fetchGenRef.current) return;
            applyPayload(first);
            setLoading(false);

            const totalItems = first.meta?.pagination?.totalItems
                ?? first.meta?.itemCount
                ?? first.recommendations?.length
                ?? 0;

            // 2) Background: load the rest so filters/pagination feel instant
            if (totalItems > PAGE_SIZE) {
                setBackgroundLoading(true);
                const full = await load(`&page=1&pageSize=0${refreshParam}`);
                if (gen !== fetchGenRef.current) return;
                applyPayload(full);
                DataCache.set(`replenishment_recs_v7_${branchToFetch}`, full, { persist: false });
            } else {
                DataCache.set(`replenishment_recs_v7_${branchToFetch}`, first, { persist: false });
            }
        } catch (err) {
            if (err.message === "Unauthorized") return;
            if (err.name === "AbortError") {
                if (!isBackground) setError("Request timed out. Try Refresh, or run Full Daily Refresh in Sync Center.");
            } else if (!isBackground) {
                setError(err.message || "Failed to load recommendations.");
            }
        } finally {
            if (gen === fetchGenRef.current) {
                setLoading(false);
                setBackgroundLoading(false);
            }
        }
    }, [activeBranch, applyPayload]);

    useEffect(() => {
        const savedView = localStorage.getItem("repl_view_mode");
        const savedBranch = localStorage.getItem("repl_selected_branch") || "";
        if (savedView === "main" || savedView === "branch") {
            setViewMode(savedView);
        } else if (savedBranch === "MAIN") {
            setViewMode("main");
        } else if (savedBranch) {
            setViewMode("branch");
            setSelectedBranch(savedBranch);
        }
    }, []);

    useEffect(() => {
        localStorage.setItem("repl_view_mode", viewMode);
        if (viewMode === "branch" && selectedBranch) {
            localStorage.setItem("repl_selected_branch", selectedBranch);
        }
    }, [viewMode, selectedBranch]);

    useEffect(() => {
        let active = true;
        const cacheKey = "replenishment_branches_v2";
        const cached = DataCache.get(cacheKey);
        if (cached?.length) setBranches(cached);

        (async () => {
            try {
                const res = await fetchWithAuth("/api/branches?source=mysql&for=replenishment");
                if (res.ok && active) {
                    const list = await res.json();
                    setBranches(list);
                    DataCache.set(cacheKey, list, { persist: false });
                }
            } catch (err) {
                console.error("Failed to load branches", err);
            }
        })();
        return () => { active = false; };
    }, []);

    useEffect(() => {
        if (viewMode !== "branch" || selectedBranch || retailBranches.length === 0) return;
        setSelectedBranch(retailBranches[0].SiteID || retailBranches[0].branch_id || "");
    }, [viewMode, selectedBranch, retailBranches]);

    useEffect(() => {
        let active = true;
        if (!activeBranch) return undefined;

        const cacheKey = `replenishment_recs_v7_${activeBranch}`;
        const cached = DataCache.get(cacheKey);

        (async () => {
            if (cached && active) {
                applyPayload(cached);
                setLoading(false);
                if (!DataCache.isFresh(cacheKey, LIST_CACHE_FRESH_MS)) {
                    await fetchRecommendations(true, activeBranch);
                }
            } else if (active) {
                await fetchRecommendations(false, activeBranch);
            }
        })();

        return () => { active = false; };
    }, [fetchRecommendations, activeBranch, applyPayload]);

    useEffect(() => {
        const onCompanyChange = () => {
            DataCache.clear();
            if (activeBranch) fetchRecommendations(false, activeBranch);
        };
        window.addEventListener("company-changed", onCompanyChange);
        return () => window.removeEventListener("company-changed", onCompanyChange);
    }, [fetchRecommendations, activeBranch]);

    const stats = useMemo(() => {
        const metaStats = meta?.stats;
        const urgent = metaStats?.urgent ?? recs.filter((r) => r.priorityLevel === "High").length;
        const soon = metaStats?.soon ?? recs.filter((r) => r.priorityLevel === "Medium").length;
        const zeroOrder = recs.filter((r) => (r.suggestedQty ?? 0) === 0).length;
        const totalSuggested = metaStats?.totalSuggested
            ?? recs.reduce((sum, r) => sum + (r.suggestedQty || 0), 0);
        return { urgent, soon, zeroOrder, totalSuggested };
    }, [recs, meta]);

    const filteredRecs = useMemo(() => {
        let list = recs;
        if (priorityFilter === "urgent") {
            list = list.filter((r) => r.priorityLevel === "High");
        } else if (priorityFilter === "soon") {
            const soonItems = list.filter((r) => r.priorityLevel === "Medium");
            list = soonItems.length > 0
                ? soonItems
                : list.filter((r) => (r.suggestedQty ?? 0) === 0);
        }
        const q = search.trim().toLowerCase();
        if (q) {
            list = list.filter((r) =>
                (r.itemId || "").toLowerCase().includes(q) ||
                (r.description || "").toLowerCase().includes(q)
            );
        }
        return list;
    }, [recs, priorityFilter, search]);

    const showingSoonFallback = useMemo(() => {
        if (priorityFilter !== "soon") return false;
        return recs.filter((r) => r.priorityLevel === "Medium").length === 0;
    }, [recs, priorityFilter]);

    useEffect(() => {
        setPage(1);
        closeAiExplain();
    }, [priorityFilter, search, viewMode, selectedBranch, closeAiExplain]);

    const totalPages = Math.max(1, Math.ceil(filteredRecs.length / PAGE_SIZE));
    const paginatedRecs = useMemo(() => {
        const start = (page - 1) * PAGE_SIZE;
        return filteredRecs.slice(start, start + PAGE_SIZE);
    }, [filteredRecs, page]);

    useEffect(() => {
        if (page > totalPages) setPage(totalPages);
    }, [page, totalPages]);

    const branchHint = isMain
        ? "MAIN warehouse: Coming PO counts open (non–On Hold) purchase orders destined for MAIN only. Branch demand is separate."
        : selectedBranch
            ? String(selectedBranch).toUpperCase() === "MANILA"
                ? "For MANILA: stock and Coming PO include related Manila warehouses (MANILA, WH1, MNL CAL WH, MNL-MRILAO). Sales stay on the MANILA branch."
                : `For ${selectedBranch}: Coming PO counts open (non–On Hold) purchase orders destined for this branch only. Request transfers from MAIN for any remaining gap.`
            : "Select a branch to view replenishment needs.";

    const scopeLabel = isMain ? "MAIN Warehouse" : (selectedBranch || "Branch");

    const exportCSV = useCallback(() => {
        const rows = filteredRecs;
        if (!rows.length) return;

        const headers = isMain
            ? ["Status", "Product ID", "Description", "Branch Order Qty", "Main Inventory", "Coming PO", "Total Branch Replenishment", "Sells Per Day", "Days Left", "Avg Lead Time", "Order Qty", "What To Do"]
            : ["Status", "Product ID", "Description", "Branch Stock", "Coming PO", "Sells Per Day", "Days Left", "Avg Lead Time", "Order Qty", "What To Do"];

        const csvRows = rows.map((rec) => {
            const ai = rec.aiInsights || {};
            const leadTime = rec.leadTimeDays ?? ai.leadTimeDays ?? "";
            const base = [
                priorityLabel(rec.priorityLevel),
                rec.itemId,
                rec.description || "",
            ];
            if (isMain) {
                base.push(
                    rec.branchOrderQty ?? 0,
                    rec.mainInventory ?? rec.currentStock ?? 0,
                    rec.comingPO ?? 0,
                    rec.totalBranchReplenishment ?? rec.branchOrderQty ?? 0
                );
            } else {
                base.push(rec.currentStock ?? 0, rec.comingPO ?? 0);
            }
            base.push(
                ai.salesVelocity ?? "",
                ai.daysRemaining ?? "",
                leadTime || "",
                rec.suggestedQty ?? 0,
                ai.whatToDo || rec.restockSource || ""
            );
            return base.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",");
        });

        const csv = [headers.join(","), ...csvRows].join("\n");
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `replenishment-${isMain ? "MAIN" : selectedBranch}-${new Date().toISOString().split("T")[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }, [filteredRecs, isMain, selectedBranch, viewMode]);

    return (
        <div className="db-root">
            <main className="db-main repl-main">
                <div className="db-page-title">
                    <h1>Replenishment</h1>
                    <p>
                        {isMain
                            ? "MAIN warehouse planning — vendor orders to supply all retail branches."
                            : "Branch replenishment — stock transfers needed from MAIN warehouse."}
                    </p>
                </div>

                {brief && (
                    <div className={`repl-summary ${stats.urgent > 0 ? "repl-summary-alert" : "repl-summary-ok"}`}>
                        <strong>{brief.title}</strong>
                        <span>{brief.action}</span>
                    </div>
                )}

                <div className="db-stats">
                    <div className="db-stat-card repl-stat-urgent">
                        <span className="db-stat-label">Urgent</span>
                        <span className="db-stat-value">{loading && recs.length === 0 ? "..." : stats.urgent}</span>
                        <span className="db-stat-sub">May run out within a week</span>
                    </div>
                    <div className="db-stat-card repl-stat-soon">
                        <span className="db-stat-label">Order soon</span>
                        <span className="db-stat-value">{loading && recs.length === 0 ? "..." : stats.soon}</span>
                        <span className="db-stat-sub">Plan restock in the next few weeks</span>
                    </div>
                    <div className="db-stat-card">
                        <span className="db-stat-label">Total units to order</span>
                        <span className="db-stat-value">{loading && recs.length === 0 ? "..." : stats.totalSuggested.toLocaleString()}</span>
                        <span className="db-stat-sub">{scopeLabel}</span>
                    </div>
                </div>

                <div className="repl-filter-tabs">
                    <button
                        type="button"
                        className={`repl-filter-tab ${priorityFilter === "all" ? "active" : ""}`}
                        onClick={() => setPriorityFilter("all")}
                    >
                        All items
                        <span className="repl-filter-tab-count">{recs.length}</span>
                    </button>
                    <button
                        type="button"
                        className={`repl-filter-tab ${priorityFilter === "soon" ? "active" : ""}`}
                        onClick={() => setPriorityFilter("soon")}
                    >
                        Order soon
                        <span className="repl-filter-tab-count">{stats.soon}</span>
                    </button>
                    <button
                        type="button"
                        className={`repl-filter-tab ${priorityFilter === "urgent" ? "active" : ""}`}
                        onClick={() => setPriorityFilter("urgent")}
                    >
                        Urgent
                        <span className="repl-filter-tab-count">{stats.urgent}</span>
                    </button>
                </div>

                <div className="db-toolbar">
                    <div className="db-toolbar-left">
                        <div className="repl-view-field">
                            <label>View</label>
                            <div className="repl-view-switch">
                                <button
                                    type="button"
                                    className={`repl-view-btn ${viewMode === "main" ? "active" : ""}`}
                                    onClick={() => setViewMode("main")}
                                >
                                    MAIN Warehouse
                                </button>
                                <button
                                    type="button"
                                    className={`repl-view-btn ${viewMode === "branch" ? "active" : ""}`}
                                    onClick={() => setViewMode("branch")}
                                >
                                    Branches
                                </button>
                            </div>
                        </div>

                        {viewMode === "branch" && (
                            <div className="repl-branch-field">
                                <label htmlFor="repl-branch">Branch</label>
                                <div className="db-select-wrapper">
                                    <select
                                        id="repl-branch"
                                        className="db-select"
                                        value={selectedBranch}
                                        onChange={(e) => setSelectedBranch(e.target.value)}
                                        disabled={retailBranches.length === 0}
                                    >
                                        {retailBranches.length === 0 ? (
                                            <option value="">No branches</option>
                                        ) : retailBranches.map((b) => (
                                            <option key={b.SiteID} value={b.SiteID}>{b.SiteID}</option>
                                        ))}
                                    </select>
                                    <IconChevron />
                                </div>
                            </div>
                        )}

                        <div className="db-search-wrapper repl-search">
                            <IconSearch />
                            <input
                                className="db-search"
                                type="text"
                                placeholder="Search product..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
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

                    <div className="db-toolbar-right">
                        <button
                            className="db-action-btn"
                            onClick={exportCSV}
                            disabled={loading || filteredRecs.length === 0}
                        >
                            <IconDownload /> Export CSV
                        </button>
                        <button
                            className="db-refresh-btn"
                            onClick={() => {
                                if (!activeBranch) return;
                                DataCache.delete(`replenishment_recs_v7_${activeBranch}`);
                                fetchRecommendations(false, activeBranch, true);
                            }}
                            disabled={loading || !activeBranch}
                        >
                            {loading ? "Loading..." : "Refresh"}
                        </button>
                    </div>
                </div>

                <p className="repl-branch-hint">
                    {branchHint}
                    {showingSoonFallback && " Showing items with no order quantity because nothing is marked order soon."}
                </p>

                {error && <div className="si-error">{error}</div>}

                {backgroundLoading && (
                    <div className="db-bg-loading">
                        <div className="db-spinner" />
                        Loading remaining items in the background…
                    </div>
                )}

                <div className={`db-table-wrap ${backgroundLoading ? "is-bg-loading" : ""}`}>
                    <table className="db-table db-table--fit repl-table">
                        <thead>
                            <tr>
                                <th style={{ width: "90px" }}>Status</th>
                                <th>Product</th>
                                {isMain ? (
                                    <>
                                        <th style={{ width: "110px", textAlign: "right" }}>Branch order qty</th>
                                        <th style={{ width: "100px", textAlign: "right" }}>Main inventory</th>
                                        <th style={{ width: "100px", textAlign: "right" }}>Coming PO</th>
                                        <th style={{ width: "120px", textAlign: "right" }}>Total branch repl.</th>
                                    </>
                                ) : (
                                    <>
                                        <th style={{ width: "100px", textAlign: "right" }}>Branch stock</th>
                                        <th style={{ width: "100px", textAlign: "right" }}>Coming PO</th>
                                    </>
                                )}
                                <th className="repl-col-th" style={{ width: "128px", textAlign: "right" }}>
                                    <ColumnInfoHeader
                                        label="Sells / day"
                                        panelId="sells-per-day"
                                        openId={openColumnInfo}
                                        setOpenId={setOpenColumnInfo}
                                        align="right"
                                    >
                                        <strong>How &quot;Sells / day&quot; is calculated</strong>
                                        <p>
                                            This is the <strong>average number of units sold per day</strong> for each product
                                            {isMain ? " across all retail branches (network demand)" : (
                                                <> at branch <strong>{selectedBranch}</strong></>
                                            )} — not today&apos;s sales alone.
                                        </p>
                                        <p className="repl-col-info-formula">
                                            Sells / day = Net units sold in the last 90 days{isMain ? " (network-wide)" : ` at ${selectedBranch}`} ÷ 90
                                        </p>
                                        <p>
                                            Sales velocity is loaded from <strong>Acumatica</strong> when you are signed in (Sales Invoices + memos, last 90 days).
                                            If Acumatica is unavailable, synced database sales are used instead. Stock on hand comes from synced inventory.
                                        </p>
                                        <p className="repl-col-info-note">
                                            <strong>Days left</strong> uses this rate: Branch stock ÷ Sells / day (e.g. 462 ÷ 70.9 ≈ 6 days).
                                            Tap <strong>Explain</strong> on any row for that product&apos;s exact numbers.
                                        </p>
                                    </ColumnInfoHeader>
                                </th>
                                <th style={{ width: "110px", textAlign: "right" }}>Days left</th>
                                <th style={{ width: "100px", textAlign: "right" }}>Avg. lead time</th>
                                <th style={{ width: "110px", textAlign: "right" }}>Order qty</th>
                                <th>What to do</th>
                                <th style={{ width: "200px" }}>
                                    <span className="repl-ai-col-head">
                                        <IconSparkles /> AI Explanation
                                    </span>
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && recs.length === 0 ? (
                                <tr>
                                    <td colSpan={isMain ? 11 : 10} className="repl-table-empty">
                                        <div className="db-spinner db-spinner-lg" style={{ margin: "0 auto 0.75rem" }} />
                                        Loading recommendations for {scopeLabel}...
                                    </td>
                                </tr>
                            ) : filteredRecs.length === 0 ? (
                                <tr>
                                    <td colSpan={isMain ? 11 : 10} className="repl-table-empty">
                                        {priorityFilter === "urgent"
                                            ? "No urgent items right now."
                                            : priorityFilter === "soon"
                                                ? "No items need ordering soon, and no zero-order items to show."
                                            : recs.length === 0
                                                ? isMain
                                                    ? "No items found for MAIN warehouse planning."
                                                    : `No items found for ${selectedBranch}.`
                                                : "No items match your search."}
                                    </td>
                                </tr>
                            ) : (
                                <ReplenishmentRows
                                    recs={paginatedRecs}
                                    onExplain={setAiExplainRec}
                                    explainId={aiExplainRec?.recommendationId}
                                    isMain={isMain}
                                />
                            )}
                        </tbody>
                    </table>
                </div>

                {filteredRecs.length > 0 && (
                    <div className="db-pagination">
                        <span className="db-page-info">
                            Showing <strong>{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredRecs.length)}</strong> of <strong>{filteredRecs.length}</strong>
                        </span>
                        <div className="db-page-btns">
                            <button className="db-page-btn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                                <IconChevronLeft />
                            </button>
                            <span className="db-page-dots">Page {page} of {totalPages}</span>
                            <button className="db-page-btn" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                                <IconChevronRight />
                            </button>
                        </div>
                    </div>
                )}

                {meta?.generatedAt && (
                    <p className="repl-footer">
                        Updated {new Date(meta.generatedAt).toLocaleString("en-PH")}
                        {meta.salesSource === "acumatica" && " · Sales from Acumatica (live)"}
                        {meta.servedFrom === "cache" && " · Loaded from replenishment cache"}
                        {meta.salesScope === "network" && " · Velocity from all branches"}
                        {meta.salesScope === "catalog-network" &&
                            " · Sales velocity from network invoices for this branch's catalog"}
                    </p>
                )}
            </main>

            <AiExplainLightbox rec={aiExplainRec} onClose={closeAiExplain} />
        </div>
    );
}
