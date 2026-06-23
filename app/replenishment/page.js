"use client";

import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import { DataCache } from "@/lib/data-cache";
import { fetchWithAuth } from "@/lib/api-client";
import "@/styles/dashboard.css";
import "@/styles/replenishment.css";

const IconSearch = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
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

function toggleAiRow(id, setExpandedAi) {
    setExpandedAi((prev) => ({ ...prev, [id]: !prev[id] }));
}

function ReplenishmentRows({ recs, expandedAi, setExpandedAi }) {
    return recs.map((rec) => {
        const ai = rec.aiInsights || {};
        const how = ai.howItWorks || {};
        const days = ai.daysRemaining;
        const ads = ai.salesVelocity;
        const hasSales = days !== "N/A" && days != null;
        const isOpen = !!expandedAi[rec.recommendationId];

        return (
            <Fragment key={rec.recommendationId}>
                <tr className={`repl-row ${priorityClass(rec.priorityLevel)}`}>
                    <td>
                        <span className={`repl-badge ${priorityClass(rec.priorityLevel)}`}>
                            {priorityLabel(rec.priorityLevel)}
                        </span>
                    </td>
                    <td>
                        <div className="repl-product-id">{rec.itemId}</div>
                        <div className="repl-product-desc">{rec.description || "—"}</div>
                    </td>
                    <td className="repl-num">{fmtNum(rec.currentStock)}</td>
                    <td className="repl-num">{hasSales ? fmtNum(ads) : "—"}</td>
                    <td className="repl-num">{hasSales ? `${fmtNum(days)} days` : "—"}</td>
                    <td className="repl-num repl-order-qty">+{fmtNum(rec.suggestedQty)}</td>
                    <td className="repl-action">{ai.whatToDo || rec.restockSource}</td>
                    <td className="repl-ai-cell">
                        <p className="repl-ai-preview">{how.preview || "Tap Explain to see how this was calculated."}</p>
                        <button
                            type="button"
                            className={`repl-ai-btn ${isOpen ? "open" : ""}`}
                            onClick={() => toggleAiRow(rec.recommendationId, setExpandedAi)}
                            aria-expanded={isOpen}
                        >
                            <IconSparkles />
                            {isOpen ? "Hide" : "Explain"}
                        </button>
                    </td>
                </tr>
                {isOpen && how.steps?.length > 0 && (
                    <tr className="repl-ai-detail-row">
                        <td colSpan={8}>
                            <div className="repl-ai-panel">
                                <div className="repl-ai-panel-header">
                                    <IconSparkles />
                                    <strong>AI Explanation</strong>
                                    <span>How this recommendation was built</span>
                                </div>
                                <ol className="repl-ai-steps">
                                    {how.steps.map((step) => (
                                        <li key={step.title}>
                                            <strong>{step.title}</strong>
                                            <p>{step.text}</p>
                                        </li>
                                    ))}
                                </ol>
                            </div>
                        </td>
                    </tr>
                )}
            </Fragment>
        );
    });
}

export default function ReplenishmentPage() {
    const [recs, setRecs] = useState([]);
    const [brief, setBrief] = useState(null);
    const [meta, setMeta] = useState(null);
    const [branches, setBranches] = useState([]);
    const [selectedBranch, setSelectedBranch] = useState("MAIN");
    const [priorityFilter, setPriorityFilter] = useState("all");
    const [search, setSearch] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [expandedAi, setExpandedAi] = useState({});

    const applyPayload = useCallback((data) => {
        const list = Array.isArray(data) ? data : (data?.recommendations ?? []);
        setRecs(list);
        setBrief(data?.brief ?? null);
        setMeta(data?.meta ?? null);
    }, []);

    const fetchRecommendations = useCallback(async (isBackground = false, branchToFetch = selectedBranch) => {
        if (!isBackground) setLoading(true);
        setError(null);
        try {
            const res = await fetchWithAuth(`/api/replenishment?branch=${branchToFetch}`);
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.message || `HTTP ${res.status}`);
            }
            const data = await res.json();
            applyPayload(data);
            DataCache.set(`replenishment_recs_${branchToFetch}`, data);
        } catch (err) {
            if (err.message === "Unauthorized") return;
            if (!isBackground) setError(err.message || "Failed to load recommendations.");
        } finally {
            setLoading(false);
        }
    }, [selectedBranch, applyPayload]);

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const res = await fetchWithAuth("/api/branches?source=mysql");
                if (res.ok && active) setBranches(await res.json());
            } catch (err) {
                console.error("Failed to load branches", err);
            }
        })();
        return () => { active = false; };
    }, []);

    useEffect(() => {
        let active = true;
        const cacheKey = `replenishment_recs_${selectedBranch}`;
        const cached = DataCache.get(cacheKey);

        (async () => {
            if (cached && active) applyPayload(cached);
            if (active) await fetchRecommendations(!!cached, selectedBranch);
        })();

        return () => { active = false; };
    }, [fetchRecommendations, selectedBranch, applyPayload]);

    const stats = useMemo(() => {
        const urgent = recs.filter((r) => r.priorityLevel === "High").length;
        const soon = recs.filter((r) => r.priorityLevel === "Medium").length;
        const totalSuggested = recs.reduce((sum, r) => sum + (r.suggestedQty || 0), 0);
        return { urgent, soon, totalSuggested };
    }, [recs]);

    const filteredRecs = useMemo(() => {
        let list = recs;
        if (priorityFilter !== "all") {
            const map = { urgent: "High", soon: "Medium", low: "Low" };
            list = list.filter((r) => r.priorityLevel === map[priorityFilter]);
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

    const isMain = selectedBranch === "MAIN";
    const branchHint = isMain
        ? "For MAIN: create a Purchase Order from your vendor."
        : `For ${selectedBranch}: request a stock transfer from MAIN.`;

    return (
        <div className="db-root">
            <main className="db-main repl-main">
                <div className="db-page-title">
                    <h1>Replenishment</h1>
                    <p>
                        Items that need restocking at your branch. Check stock, how fast it sells, and how many to order.
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
                        <span className="db-stat-sub">{selectedBranch}</span>
                    </div>
                </div>

                <div className="db-toolbar">
                    <div className="db-toolbar-left">
                        <div className="repl-branch-field">
                            <label htmlFor="repl-branch">Branch</label>
                            <div className="db-select-wrapper">
                                <select
                                    id="repl-branch"
                                    className="db-select"
                                    value={selectedBranch}
                                    onChange={(e) => setSelectedBranch(e.target.value)}
                                >
                                    <option value="MAIN">MAIN</option>
                                    {branches.filter((b) => b.SiteID !== "MAIN" && b.SiteID !== "__catalog__").map((b) => (
                                        <option key={b.SiteID} value={b.SiteID}>{b.SiteID}</option>
                                    ))}
                                </select>
                                <IconChevron />
                            </div>
                        </div>

                        <div className="repl-priority-field">
                            <label htmlFor="repl-priority">Show</label>
                            <div className="db-select-wrapper">
                                <select
                                    id="repl-priority"
                                    className="db-select"
                                    value={priorityFilter}
                                    onChange={(e) => setPriorityFilter(e.target.value)}
                                >
                                    <option value="all">All items ({recs.length})</option>
                                    <option value="urgent">Urgent only ({stats.urgent})</option>
                                    <option value="soon">Order soon ({stats.soon})</option>
                                    <option value="low">Low priority ({recs.filter((r) => r.priorityLevel === "Low").length})</option>
                                </select>
                                <IconChevron />
                            </div>
                        </div>

                        <div className="db-search-wrapper repl-search">
                            <IconSearch />
                            <input
                                className="db-search"
                                type="search"
                                placeholder="Search product..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="db-toolbar-right">
                        <button
                            className="db-refresh-btn"
                            onClick={() => {
                                DataCache.delete(`replenishment_recs_${selectedBranch}`);
                                fetchRecommendations(false, selectedBranch);
                            }}
                            disabled={loading}
                        >
                            {loading ? "Loading..." : "Refresh"}
                        </button>
                    </div>
                </div>

                <p className="repl-branch-hint">{branchHint}</p>

                {error && <div className="si-error">{error}</div>}

                <div className="db-table-wrap">
                    <table className="db-table repl-table">
                        <thead>
                            <tr>
                                <th style={{ width: "90px" }}>Status</th>
                                <th>Product</th>
                                <th style={{ width: "100px", textAlign: "right" }}>In stock</th>
                                <th style={{ width: "110px", textAlign: "right" }}>Sells / day</th>
                                <th style={{ width: "110px", textAlign: "right" }}>Days left</th>
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
                                    <td colSpan={8} className="repl-table-empty">
                                        <div className="db-spinner db-spinner-lg" style={{ margin: "0 auto 0.75rem" }} />
                                        Loading recommendations for {selectedBranch}...
                                    </td>
                                </tr>
                            ) : filteredRecs.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="repl-table-empty">
                                        {recs.length === 0
                                            ? `No restock needed at ${selectedBranch}. Stock looks good based on recent sales.`
                                            : "No items match your search or filter."}
                                    </td>
                                </tr>
                            ) : (
                                <ReplenishmentRows
                                    recs={filteredRecs}
                                    expandedAi={expandedAi}
                                    setExpandedAi={setExpandedAi}
                                />
                            )}
                        </tbody>
                    </table>
                </div>

                {meta?.generatedAt && (
                    <p className="repl-footer">
                        Updated {new Date(meta.generatedAt).toLocaleString("en-PH")}
                    </p>
                )}
            </main>
        </div>
    );
}
