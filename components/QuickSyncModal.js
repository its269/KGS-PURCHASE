"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import "@/styles/sync.css";

/* ── SVG Icons ─────────────────────────────────────────── */
const IconClose = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" cy1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
);
const IconSync = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />
        <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 16h5v5" />
    </svg>
);
const IconRocket = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
        <path d="M9 12H4s.55-3.03 2-5c1.62-2.2 5-3 5-3" /><path d="M12 15v5s3.03-.55 5-2c2.2-1.62 3-5 3-5" />
    </svg>
);
const IconTarget = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="2" />
    </svg>
);
const IconCheck = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
    </svg>
);
const IconAlert = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
);

const MODULES = [
    { id: "inventory", name: "Inventory", apiFlag: "inventory" },
    { id: "sales", name: "Sales", apiFlag: "sales" },
];

export default function QuickSyncModal({ isOpen, onClose, onStatusChange }) {
    const [syncType, setSyncType] = useState("all");
    const [selectedModules, setSelectedModules] = useState({ inventory: true });
    const [isSyncing, setIsSyncing] = useState(false);
    const [sections, setSections] = useState({});
    const [logs, setLogs] = useState([]);
    const [complete, setComplete] = useState(false);
    const [error, setError] = useState(null);
    const [isUnfinished, setIsUnfinished] = useState(false);
    const [overallProgress, setOverallProgress] = useState(0);
    const [displayProgress, setDisplayProgress] = useState(0);
    const logsEndRef = useRef(null);

    // Smooth progress animation
    useEffect(() => {
        if (!isSyncing && !complete) return;
        const interval = setInterval(() => {
            setDisplayProgress(prev => {
                if (prev < overallProgress) return Math.min(prev + 1, overallProgress, 100);
                return prev;
            });
        }, 30);
        return () => clearInterval(interval);
    }, [isSyncing, complete, overallProgress]);

    const toggleModule = (id) => {
        if (isSyncing) return;
        setSelectedModules(prev => ({ ...prev, [id]: !prev[id] }));
    };

    const addLog = (msg) => {
        setLogs(prev => {
            const next = [...prev, msg];
            setTimeout(() => logsEndRef.current?.scrollIntoView({ behavior: "smooth" }), 30);
            return next;
        });
    };

    const handleSync = async () => {
        if (isSyncing) return;

        let useInventory = syncType === "all" || selectedModules.inventory;
        let useSales = syncType === "all" ? false : selectedModules.sales;

        if (!useInventory && !useSales) return;

        setIsSyncing(true);
        setComplete(false);
        setError(null);
        setIsUnfinished(false);
        setSections({});
        setLogs([]);
        setOverallProgress(0);
        setDisplayProgress(0);
        onStatusChange?.("syncing");

        let finishedProperly = false;

        try {
            const mode = syncType === "delta" ? "delta" : "incremental";
            const res = await fetch(`/api/sync?inventory=${useInventory}&sales=${useSales}&mode=${mode}`, { method: "POST" });
            if (!res.ok) throw new Error(`Sync failed (HTTP ${res.status})`);

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
                                const next = { ...prev, [data.section]: { status: data.status, details: data.details, progress: data.progress ?? 0 } };
                                const vals = Object.values(next);
                                const total = vals.reduce((a, s) => a + (s.progress || 0), 0);
                                setOverallProgress(Math.floor(total / vals.length));
                                return next;
                            });
                            if (data.details) addLog(`[${data.section}] ${data.details}`);
                        }
                        if (data.status === "complete") { 
                            setComplete(true); 
                            setOverallProgress(100); 
                            onStatusChange?.("complete");
                            finishedProperly = true;
                        }
                        if (data.status === "error") { 
                            setError(data.message); 
                            onStatusChange?.("error");
                            finishedProperly = true;
                        }
                    } catch {}
                }
            }
            
            if (!finishedProperly) {
                setIsUnfinished(true);
                onStatusChange?.("unfinished");
            }
        } catch (err) {
            setError(err.message);
            onStatusChange?.("error");
        } finally {
            setIsSyncing(false);
        }
    };

    const handleClose = () => {
        if (isSyncing) return;
        setSyncType("all");
        setSelectedModules({ inventory: true });
        setIsSyncing(false);
        setComplete(false);
        setError(null);
        setIsUnfinished(false);
        setOverallProgress(0);
        setDisplayProgress(0);
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="sync-modal-overlay">
            <div className="sync-modal-card">
                <div className="sync-modal-header">
                    <h2>{isSyncing ? "Synchronization" : complete ? "Sync Complete" : error ? "Sync Failed" : isUnfinished ? "Sync Unfinished" : "Quick Sync"}</h2>
                    {!isSyncing && (
                        <button className="sync-modal-close" onClick={handleClose}><IconClose /></button>
                    )}
                </div>

                <div className="sync-modal-body">
                    {!isSyncing && !complete && !error && !isUnfinished ? (
                        <div className="qs-strategy-list">
                            <button className={`qs-card ${syncType === 'delta' ? 'active' : ''}`} onClick={() => setSyncType('delta')}>
                                <div className="qs-card-icon"><IconRocket /></div>
                                <div className="qs-card-info">
                                    <span className="qs-card-title">Sync Today&apos;s Changes</span>
                                    <span className="qs-card-desc">Only sync items sold or updated today.</span>
                                </div>
                            </button>
                            <button className={`qs-card ${syncType === 'all' ? 'active' : ''}`} onClick={() => setSyncType('all')}>
                                <div className="qs-card-icon"><IconSync /></div>
                                <div className="qs-card-info">
                                    <span className="qs-card-title">Full Daily Refresh</span>
                                    <span className="qs-card-desc">Sync all 3,000+ inventory items.</span>
                                </div>
                            </button>
                            <button className={`qs-card ${syncType === 'specific' ? 'active' : ''}`} onClick={() => setSyncType('specific')}>
                                <div className="qs-card-icon"><IconTarget /></div>
                                <div className="qs-card-info">
                                    <span className="qs-card-title">Custom Selection</span>
                                    <span className="qs-card-desc">Pick specific data modules to sync.</span>
                                </div>
                            </button>

                            {syncType === "specific" && (
                                <div className="qs-module-pills">
                                    {MODULES.map(m => (
                                        <button key={m.id} className={`qs-pill ${selectedModules[m.id] ? 'active' : ''}`} onClick={() => toggleModule(m.id)}>
                                            {m.name}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div>
                            <div className={`qs-status-banner ${complete ? 'complete' : error ? 'error' : isUnfinished ? 'error' : 'syncing'}`}>
                                <div style={{ 
                                    width: '8px', height: '8px', borderRadius: '50%', 
                                    background: complete ? '#22c55e' : error || isUnfinished ? '#ef4444' : '#3b82f6',
                                    animation: !complete && !error && !isUnfinished ? 'pulse 1.5s infinite' : 'none',
                                    marginRight: '8px'
                                }}></div>
                                <span style={{ flex: 1 }}>
                                    {complete ? "Sync successful" : error ? "Sync failed" : isUnfinished ? "Sync was interrupted" : "Synchronizing data..."}
                                </span>
                                {complete && <IconCheck />}
                                {(error || isUnfinished) && <IconAlert />}
                            </div>

                            <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
                                <div style={{ fontSize: '2.5rem', fontWeight: '700', color: error || isUnfinished ? '#ef4444' : 'inherit' }}>{displayProgress}%</div>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                {Object.entries(sections).map(([name, data]) => (
                                    <div key={name} style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                        <div className="sync-progress-label">
                                            <span style={{ fontSize: '0.85rem', fontWeight: '500' }}>{name}</span>
                                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{data.progress || 0}%</span>
                                        </div>
                                        <div className="sync-progress-track">
                                            <div className="sync-progress-bar" style={{ 
                                                width: `${data.progress || 0}%`,
                                                background: error || isUnfinished ? '#fca5a5' : data.status === 'done' ? '#22c55e' : 'var(--primary)'
                                            }} />
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {(logs.length > 0 && !complete && !error && !isUnfinished) && (
                                <div className="qs-log-container">
                                    {logs.slice(-3).map((log, i) => (
                                        <div key={i} className="qs-log-line">{log}</div>
                                    ))}
                                    <div ref={logsEndRef} />
                                </div>
                            )}

                            {error && (
                                <div style={{ 
                                    color: '#991b1b', background: '#fef2f2', border: '1px solid #fecaca',
                                    fontSize: '0.8rem', marginTop: '1rem', padding: '0.75rem', borderRadius: '8px',
                                    display: 'flex', gap: '8px'
                                }}>
                                    <IconAlert />
                                    <span>{error}</span>
                                </div>
                            )}
                            
                            {isUnfinished && (
                                <div style={{ 
                                    color: '#92400e', background: '#fffbeb', border: '1px solid #fef3c7',
                                    fontSize: '0.8rem', marginTop: '1rem', padding: '0.75rem', borderRadius: '8px',
                                    display: 'flex', gap: '8px'
                                }}>
                                    <IconAlert />
                                    <span>The synchronization process ended unexpectedly. Some data might be incomplete.</span>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="sync-modal-footer">
                    {!isSyncing && (
                        <button className="sync-start-btn" onClick={complete || error || isUnfinished ? handleClose : handleSync} style={{ 
                            width: '100%',
                            background: error || isUnfinished ? '#475569' : undefined
                        }}>
                            {complete ? "Close" : error || isUnfinished ? "Close & Retry" : "Start Sync"}
                        </button>
                    )}
                    {isSyncing && (
                        <div style={{ width: '100%', textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                            Stay on this page until finished.
                        </div>
                    )}
                </div>
            </div>
            
            <style jsx>{`
                @keyframes pulse {
                    0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.7); }
                    70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(59, 130, 246, 0); }
                    100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); }
                }
            `}</style>
        </div>
    );
}
