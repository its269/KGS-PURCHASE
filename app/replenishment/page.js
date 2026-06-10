"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { DataCache } from "@/lib/data-cache";
import "@/styles/dashboard.css";
import "@/styles/stock-items.css";

/* ── SVG Icons ─────────────────────────────────────────── */
const IconSparkles = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" /><path d="M5 3v4" /><path d="M19 17v4" /><path d="M3 5h4" /><path d="M17 19h4" />
    </svg>
);
const IconAlertCircle = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
);
const IconCalendar = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
);

function priorityClass(priority) {
    if (priority === "High") return "db-status-badge po-status-cancelled"; // Red
    if (priority === "Medium") return "db-status-badge po-status-open";    // Blue/Yellow
    return "db-status-badge po-status-closed";                            // Grey/Green
}

function fmtDate(d) {
    if (!d) return "—";
    return new Date(d).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric", hour: '2-digit', minute: '2-digit' });
}

export default function ReplenishmentPage() {
    const [recs, setRecs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Initial restoration & Hydration fix
    useEffect(() => {
        Promise.resolve().then(() => {
            const cached = DataCache.get("replenishment_recs");
            if (cached) setRecs(cached || []);
        });
    }, []);

    const fetchRecommendations = useCallback(async (isBackground = false) => {
        if (!isBackground) setLoading(true);
        setError(null);
        try {
            const cacheKey = "replenishment_recs";
            const res = await fetch("/api/replenishment");
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setRecs(data);
            DataCache.set(cacheKey, data);
        } catch (err) {
            if (!isBackground) setError("Failed to generate recommendations. Please try again.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        const cacheKey = "replenishment_recs";
        const cached = DataCache.get(cacheKey);
        if (cached) {
            Promise.resolve().then(() => fetchRecommendations(true));
        } else {
            Promise.resolve().then(() => fetchRecommendations(false));
        }
    }, [fetchRecommendations]);

    const stats = useMemo(() => {
        const highPriority = recs.filter(r => r.priorityLevel === "High").length;
        const totalSuggested = recs.reduce((sum, r) => sum + r.suggestedQty, 0);
        return { highPriority, totalSuggested };
    }, [recs]);

    return (
        <div className="db-root">
            <main className="db-main">
                <div className="db-page-title">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem' }}>
                        <div style={{ background: '#fef3c7', color: '#d97706', padding: '0.75rem', borderRadius: '12px' }}>
                            <IconSparkles />
                        </div>
                        <h1 style={{ margin: 0 }}>Replenishment Recommendations</h1>
                    </div>
                    <p>AI-driven suggestions for restocking based on live inventory availability.</p>
                </div>

                <div className="db-stats" style={{ marginBottom: '2rem' }}>
                    <div className="db-stat-card db-stat-blue">
                        <span className="db-stat-label">Critical Alerts</span>
                        <span className="db-stat-value" style={{ color: '#ef4444' }}>{stats.highPriority}</span>
                        <span className="db-stat-sub">High Priority Items</span>
                    </div>
                    <div className="db-stat-card">
                        <span className="db-stat-label">Suggested Restock</span>
                        <span className="db-stat-value">{stats.totalSuggested.toLocaleString()}</span>
                        <span className="db-stat-sub">Total units recommended</span>
                    </div>
                    <div className="db-stat-card">
                        <span className="db-stat-label">Analysis Coverage</span>
                        <span className="db-stat-value">{recs.length}</span>
                        <span className="db-stat-sub">Items analyzed in ERP</span>
                    </div>
                </div>

                <div className="db-toolbar" style={{ borderRadius: '16px', padding: '1.25rem' }}>
                    <div className="db-toolbar-left">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#64748b', fontSize: '0.85rem', fontWeight: '500' }}>
                            <IconCalendar />
                            <span>Last Analysis: {recs.length > 0 ? fmtDate(recs[0].generatedDate) : "Never"}</span>
                        </div>
                    </div>
                    <div className="db-toolbar-right">
                        <button 
                            className="db-refresh-btn" 
                            onClick={() => {
                                DataCache.delete("replenishment_recs");
                                fetchRecommendations();
                            }} 
                            disabled={loading}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                {loading && <div className="db-spinner" style={{ width: '14px', height: '14px', borderWidth: '2px' }}></div>}
                                <span>{loading ? "Analyzing..." : "Run Analysis"}</span>
                            </div>
                        </button>
                    </div>
                </div>

                {error && <div className="si-error">{error}</div>}

                <div className="db-table-wrap" style={{ borderRadius: '16px', overflow: 'hidden', border: '1px solid #e2e8f0' }}>
                    <table className="db-table">
                        <thead style={{ background: '#f8fafc' }}>
                            <tr>
                                <th style={{ padding: '1.25rem' }}>Rec. ID</th>
                                <th style={{ padding: '1.25rem' }}>Item ID</th>
                                <th>Description</th>
                                <th style={{ textAlign: 'right' }}>Current Stock</th>
                                <th style={{ textAlign: 'right' }}>Suggested Qty</th>
                                <th style={{ textAlign: 'center' }}>Priority</th>
                                <th style={{ padding: '1.25rem', textAlign: 'right' }}>Generated</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && recs.length === 0 ? (
                                <tr><td colSpan={7} className="si-loading-cell">
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', padding: '4rem' }}>
                                        <div className="db-spinner db-spinner-lg"></div>
                                        <span style={{ color: '#64748b' }}>Running replenishment algorithms...</span>
                                    </div>
                                </td></tr>
                            ) : recs.length === 0 ? (
                                <tr><td colSpan={7} className="si-empty-cell" style={{ padding: '4rem' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                                        <IconAlertCircle />
                                        <span>No replenishment needed at this time. All scanned items have healthy stock levels (&gt;50 units).</span>
                                        <button 
                                            onClick={() => fetchRecommendations()} 
                                            style={{ background: 'none', border: '1px solid #2563eb', color: '#2563eb', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem' }}
                                        >
                                            Scan Again
                                        </button>
                                    </div>
                                </td></tr>
                            ) : recs.map(r => (
                                <tr key={r.recommendationId} className="db-clickable-row">
                                    <td style={{ padding: '1.25rem' }}>
                                        <span style={{ fontWeight: '700', color: '#2563eb' }}>{r.recommendationId}</span>
                                    </td>
                                    <td>
                                        <span className="db-inv-id">{r.itemId}</span>
                                    </td>
                                    <td className="db-desc">{r.description}</td>
                                    <td style={{ textAlign: 'right', fontWeight: '500' }}>{r.currentStock}</td>
                                    <td style={{ textAlign: 'right' }}>
                                        <div style={{ fontWeight: '700', color: '#0f172a' }}>+{r.suggestedQty}</div>
                                        <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>units</div>
                                    </td>
                                    <td style={{ textAlign: 'center' }}>
                                        <span className={priorityClass(r.priorityLevel)}>{r.priorityLevel}</span>
                                    </td>
                                    <td style={{ padding: '1.25rem', textAlign: 'right', color: '#64748b', fontSize: '0.8rem' }}>
                                        {fmtDate(r.generatedDate)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div style={{ marginTop: '2rem', padding: '1.5rem', background: '#f8fafc', borderRadius: '16px', border: '1px dashed #cbd5e1' }}>
                    <div style={{ display: 'flex', gap: '1rem' }}>
                        <div style={{ color: '#3b82f6' }}><IconAlertCircle /></div>
                        <div>
                            <h4 style={{ margin: '0 0 0.5rem 0', color: '#0f172a' }}>How suggestions are calculated</h4>
                            <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b', lineHeight: '1.5' }}>
                                Recommendations are generated by analyzing live warehouse availability against a baseline threshold of 50 units.
                                <strong>High Priority</strong> is assigned to items with fewer than 10 units remaining.
                            </p>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
