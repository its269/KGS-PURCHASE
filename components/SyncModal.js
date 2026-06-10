"use client";

import { useState, useRef, useEffect } from "react";
import "@/styles/sync.css";

/* ── SVG Icons ─────────────────────────────────────────── */
const IconCheck = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
    </svg>
);

const IconClose = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" cy1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
);

export default function SyncModal({ isOpen, onClose, onSyncComplete }) {
    const [syncing, setSyncing] = useState(false);
    const [mode, setMode] = useState("incremental");
    const [options, setOptions] = useState({ inventory: true, sales: false });
    const [dateRange, setDateRange] = useState({ 
        start: "2024-01-01", 
        end: new Date().toISOString().split('T')[0] 
    });
    const [sections, setSections] = useState({});
    const [overallProgress, setOverallProgress] = useState(0);
    const [complete, setComplete] = useState(false);
    const [error, setError] = useState(null);

    // Smooth animation states
    const [displayOverall, setDisplayOverall] = useState(0);
    const [displaySections, setDisplaySections] = useState({});

    const syncingRef = useRef(false);

    // Animation Effect
    useEffect(() => {
        if (!syncing) return;

        const interval = setInterval(() => {
            setDisplayOverall(prev => {
                if (prev < overallProgress) return Math.min(prev + 1, overallProgress, 100);
                return Math.min(prev, 100);
            });

            setDisplaySections(prev => {
                const next = { ...prev };
                let changed = false;
                Object.keys(sections).forEach(key => {
                    const target = Math.min(100, sections[key].progress || 0);
                    const current = next[key] || 0;
                    if (current < target) {
                        next[key] = Math.min(current + 1, target, 100);
                        changed = true;
                    }
                });
                return changed ? next : prev;
            });
        }, 30);

        return () => clearInterval(interval);
    }, [syncing, overallProgress, sections]);

    const handleToggleOption = (key) => {
        if (syncing) return;
        setOptions(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const startSync = async () => {
        if (syncing || syncingRef.current) return;
        const selectedCount = Object.keys(options).filter(k => options[k]).length;
        if (selectedCount === 0) return;

        setSyncing(true);
        syncingRef.current = true;
        setComplete(false);
        setError(null);
        setSections({});
        setOverallProgress(0);
        setDisplayOverall(0);
        setDisplaySections({});

        try {
            const queryParams = new URLSearchParams({
                inventory: options.inventory,
                sales: options.sales,
                mode: mode,
                startDate: dateRange.start,
                endDate: dateRange.end
            });
            const res = await fetch(`/api/sync?${queryParams.toString()}`, { method: "POST" });
            if (!res.ok) throw new Error("Failed to start sync");

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop();
                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const data = JSON.parse(line);
                        if (data.section) {
                            setSections(prev => {
                                const newSections = { 
                                    ...prev, 
                                    [data.section]: { 
                                        status: data.status, 
                                        details: data.details, 
                                        progress: data.progress,
                                        count: data.count || prev[data.section]?.count || 0
                                    } 
                                };
                                const sectionValues = Object.values(newSections);
                                const totalProg = sectionValues.reduce((acc, s) => acc + (s.progress || 0), 0);
                                setOverallProgress(Math.floor(totalProg / selectedCount));
                                return newSections;
                            });
                        }
                        if (data.status === "complete") { setComplete(true); setOverallProgress(100); }
                        if (data.status === "error") setError(data.message);
                    } catch (e) {}
                }
            }
        } catch (err) { setError(err.message); } finally { syncingRef.current = false; }
    };

    if (!isOpen) return null;

    return (
        <div className="db-modal-overlay sync-modal-overlay" style={{ zIndex: 10001 }}>
            <div className="db-modal" style={{ maxWidth: '400px', borderRadius: '12px' }}>
                <div className="db-modal-header" style={{ padding: '1.5rem', border: 'none' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                        <h2 style={{ fontSize: '1.25rem', fontWeight: '600', margin: 0 }}>{syncing ? "Syncing..." : "Sync Data"}</h2>
                        {!syncing && <button className="db-modal-close" onClick={onClose} style={{ position: 'static' }}><IconClose /></button>}
                    </div>
                </div>

                <div className="db-modal-body" style={{ padding: '0 1.5rem 1.5rem' }}>
                    {!syncing ? (
                        <div className="sync-modal-body">
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                <label className={`sync-option-card ${options.inventory ? 'selected' : ''}`}>
                                    <input type="checkbox" checked={options.inventory} onChange={() => handleToggleOption('inventory')} style={{ display: 'none' }} />
                                    <div style={{ flex: 1 }}>
                                        <div className="sync-option-title">Inventory</div>
                                        <div className="sync-option-desc">Stock levels & Products</div>
                                    </div>
                                    {options.inventory && <IconCheck />}
                                </label>
                                <label className={`sync-option-card ${options.sales ? 'selected' : ''}`}>
                                    <input type="checkbox" checked={options.sales} onChange={() => handleToggleOption('sales')} style={{ display: 'none' }} />
                                    <div style={{ flex: 1 }}>
                                        <div className="sync-option-title">Sales history</div>
                                        <div className="sync-option-desc">Periodic sales data</div>
                                    </div>
                                    {options.sales && <IconCheck />}
                                </label>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                                <button onClick={() => setMode("incremental")} className={`sync-option-card ${mode === 'incremental' ? 'selected' : ''}`} style={{ flex: 1, justifyContent: 'center' }}>
                                    <span className="sync-option-title">Quick</span>
                                </button>
                                <button onClick={() => setMode("full")} className={`sync-option-card ${mode === 'full' ? 'selected' : ''}`} style={{ flex: 1, justifyContent: 'center' }}>
                                    <span className="sync-option-title">Full</span>
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                            <div style={{ textAlign: 'center', fontSize: '2rem', fontWeight: '700' }}>{displayOverall}%</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                {Object.entries(sections).map(([name, data]) => (
                                    <div key={name} style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                        <div className="sync-progress-label">
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <span style={{ fontSize: '0.85rem', fontWeight: '500' }}>{name}</span>
                                                {data.count > 0 && (
                                                    <span style={{ 
                                                        fontSize: '0.7rem', 
                                                        background: '#f1f5f9', 
                                                        padding: '1px 6px', 
                                                        borderRadius: '10px', 
                                                        color: '#64748b',
                                                        fontWeight: '600'
                                                    }}>
                                                        {data.count.toLocaleString()} {name === 'Inventory' ? 'items' : 'records'}
                                                    </span>
                                                )}
                                            </div>
                                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{displaySections[name] || 0}%</span>
                                        </div>
                                        <div className="sync-progress-track">
                                            <div className="sync-progress-bar" style={{ width: `${displaySections[name] || 0}%` }} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                            {complete && <div style={{ textAlign: 'center', color: '#16a34a', fontSize: '0.9rem', fontWeight: '600' }}>Sync complete</div>}
                            {error && <div style={{ textAlign: 'center', color: '#dc2626', fontSize: '0.9rem' }}>{error}</div>}
                        </div>
                    )}
                </div>

                <div className="db-modal-footer" style={{ padding: '1.5rem', border: 'none' }}>
                    {!syncing ? (
                        <button className="sync-start-btn" onClick={startSync} style={{ width: '100%' }}>Start Synchronization</button>
                    ) : (
                        <button className="sync-start-btn" disabled={!complete && !error} onClick={onClose} style={{ width: '100%', background: complete ? '#16a34a' : (error ? '#dc2626' : '#94a3b8') }}>
                            {complete || error ? "Close" : "Syncing..."}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
