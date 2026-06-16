"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { DataCache } from "@/lib/data-cache";
import { fetchWithAuth } from "@/lib/api-client";
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
const IconInfo = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
);
const IconBrain = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.48-2.04z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.48-2.04z"/>
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
    const [showInfo, setShowInfo] = useState(false);

    const fetchRecommendations = useCallback(async (isBackground = false) => {
        if (!isBackground) setLoading(true);
        setError(null);
        try {
            const cacheKey = "replenishment_recs";
            const res = await fetchWithAuth("/api/replenishment");
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.message || `HTTP ${res.status}`);
            }
            const data = await res.json();
            setRecs(data || []);
            DataCache.set(cacheKey, data || []);
        } catch (err) {
            if (err.message === "Unauthorized") return;
            if (!isBackground) setError(err.message || "Failed to generate recommendations. Please try again.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        const cacheKey = "replenishment_recs";
        const cached = DataCache.get(cacheKey);
        if (cached) {
            setRecs(cached || []);
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
                        <div style={{ background: 'var(--bg-surface)', color: 'var(--accent-primary)', padding: '0.75rem', borderRadius: '12px', border: '1px solid var(--border-light)' }}>
                            <IconSparkles />
                        </div>
                        <h1 style={{ margin: 0 }}>Replenishment Recommendations</h1>
                    </div>
                    <p>Advanced AI-driven insights for restocking based on sales velocity and warehouse availability.</p>
                </div>

                <div className="db-stats" style={{ marginBottom: '2rem' }}>
                    <div className="db-stat-card db-stat-danger">
                        <span className="db-stat-label">Stockout Risk</span>
                        <span className="db-stat-value" style={{ color: 'var(--status-danger)' }}>{stats.highPriority}</span>
                        <span className="db-stat-sub">High Risk Items</span>
                    </div>
                    <div className="db-stat-card">
                        <span className="db-stat-label">Total Suggested</span>
                        <span className="db-stat-value">{stats.totalSuggested.toLocaleString()}</span>
                        <span className="db-stat-sub">Optimized units recommended</span>
                    </div>
                    <div className="db-stat-card">
                        <span className="db-stat-label">AI Coverage</span>
                        <span className="db-stat-value">{recs.length}</span>
                        <span className="db-stat-sub">Items analyzed with Sales Velocity</span>
                    </div>
                </div>

                <div className="db-toolbar" style={{ borderRadius: '16px', padding: '1.25rem' }}>
                    <div className="db-toolbar-left">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: '500' }}>
                            <IconCalendar />
                            <span>Last Intelligence Run: {recs.length > 0 ? fmtDate(recs[0].generatedDate) : "Never"}</span>
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
                                <span>{loading ? "Thinking..." : "Re-Calculate AI"}</span>
                            </div>
                        </button>
                    </div>
                </div>

                {error && <div className="si-error">{error}</div>}

                <div className="db-table-wrap" style={{ borderRadius: '16px', overflow: 'hidden' }}>
                    <table className="db-table">
                        <thead style={{ background: 'var(--bg-main)' }}>
                            <tr>
                                <th style={{ padding: '1.25rem' }}>Item ID</th>
                                <th>Description</th>
                                <th style={{ textAlign: 'right' }}>Current Stock</th>
                                <th style={{ textAlign: 'center' }}>Priority</th>
                                <th style={{ textAlign: 'center' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                                        AI Insights
                                        <button 
                                            onClick={() => setShowInfo(!showInfo)}
                                            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center' }}
                                        >
                                            <IconInfo />
                                        </button>
                                    </div>
                                </th>
                                <th style={{ textAlign: 'right' }}>Suggested Restock</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && recs.length === 0 ? (
                                <tr><td colSpan={6} className="si-loading-cell">
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', padding: '4rem' }}>
                                        <div className="db-spinner db-spinner-lg"></div>
                                        <span style={{ color: 'var(--text-secondary)' }}>Processing warehouse logs & sales velocity...</span>
                                    </div>
                                </td></tr>
                            ) : recs.length === 0 ? (
                                <tr><td colSpan={6} className="si-empty-cell" style={{ padding: '4rem' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                                        <div style={{ color: 'var(--status-warning)' }}><IconAlertCircle /></div>
                                        <span>No replenishment needed at this time. All items have healthy stock levels.</span>
                                        <button 
                                            onClick={() => fetchRecommendations()} 
                                            className="db-action-btn db-action-sync"
                                            style={{ height: '36px', padding: '0 1.5rem', fontSize: '0.85rem' }}
                                        >
                                            Analyze Again
                                        </button>
                                    </div>
                                </td></tr>
                            ) : recs.map(r => (
                                <tr key={r.recommendationId} className="db-clickable-row">
                                    <td style={{ padding: '1.25rem' }}>
                                        <span className="db-inv-id">{r.itemId}</span>
                                    </td>
                                    <td className="db-desc">{r.description}</td>
                                    <td style={{ textAlign: 'right', fontWeight: '600' }}>{r.currentStock}</td>
                                    <td style={{ textAlign: 'center' }}>
                                        <span className={priorityClass(r.priorityLevel)}>{r.priorityLevel}</span>
                                    </td>
                                    <td style={{ textAlign: 'left', minWidth: '300px' }}>
                                        <div style={{ padding: '0.75rem', background: 'rgba(99, 102, 241, 0.04)', borderRadius: '8px', border: '1px solid rgba(99, 102, 241, 0.1)' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                                                <div style={{ color: 'var(--accent-primary)' }}><IconBrain /></div>
                                                <span style={{ fontSize: '0.75rem', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--accent-primary)' }}>AI Analysis</span>
                                            </div>
                                            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                                                {r.aiInsights?.message || "Analyzing stock patterns..."}
                                            </p>
                                            <div style={{ marginTop: '0.5rem', fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                <IconSparkles /> Formula: {r.aiInsights?.formula}
                                            </div>
                                        </div>
                                    </td>
                                    <td style={{ textAlign: 'right', padding: '1.25rem' }}>
                                        <div style={{ fontWeight: '800', color: 'var(--text-primary)', fontSize: '1.1rem' }}>+{r.suggestedQty}</div>
                                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: '600' }}>OPTIMIZED UNITS</div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {showInfo && (
                    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(4px)' }} onClick={() => setShowInfo(false)}>
                        <div style={{ background: 'var(--bg-surface)', padding: '2rem', borderRadius: '20px', maxWidth: '500px', width: '90%', boxShadow: 'var(--shadow-lg)', border: '1px solid var(--border-medium)' }} onClick={e => e.stopPropagation()}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', color: 'var(--accent-primary)' }}>
                                <IconBrain />
                                <h3 style={{ margin: 0 }}>Advanced Replenishment AI</h3>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: '1.6' }}>
                                <section>
                                    <strong style={{ color: 'var(--text-primary)' }}>1. Sales Velocity Algorithm</strong>
                                    <p style={{ margin: '0.25rem 0 0 0' }}>The AI calculates Average Daily Sales by scanning the last 90 days of transaction data from the MySQL database.</p>
                                </section>
                                <section>
                                    <strong style={{ color: 'var(--text-primary)' }}>2. Stockout Prediction</strong>
                                    <p style={{ margin: '0.25rem 0 0 0' }}>It predicts the "Days Remaining" by dividing Current Stock by Sales Velocity. If stock lasts less than 7 days, it triggers a High Priority alert.</p>
                                </section>
                                <section>
                                    <strong style={{ color: 'var(--text-primary)' }}>3. Optimized Order Quantity</strong>
                                    <p style={{ margin: '0.25rem 0 0 0' }}>Instead of a fixed threshold, the AI suggests quantities that bring stock back to an 100-unit baseline, adjusted for high-turnover items.</p>
                                </section>
                            </div>
                            <button 
                                className="db-action-btn" 
                                style={{ width: '100%', marginTop: '2rem', background: 'var(--text-primary)', color: '#fff' }}
                                onClick={() => setShowInfo(false)}
                            >
                                Got it
                            </button>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
