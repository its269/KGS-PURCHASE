"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import "@/styles/sync.css";

/* ── SVG Icons ───────────────────────────────────── */
const IconSync = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />
        <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 16h5v5" />
    </svg>
);

const IconRocket = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
        <path d="M9 12H4s.55-3.03 2-5c1.62-2.2 5-3 5-3" /><path d="M12 15v5s3.03-.55 5-2c2.2-1.62 3-5 3-5" />
    </svg>
);

const IconCheck = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--status-success)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
    </svg>
);

const IconAlert = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--status-danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
);

const IconChevronLeft = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15 18 9 12 15 6" />
    </svg>
);

export default function SyncingClient() {
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncMode, setSyncMode] = useState(null); // 'full' or 'quick'
    const [sections, setSections] = useState({});
    const [overallProgress, setOverallProgress] = useState(0);
    const [complete, setComplete] = useState(false);
    const [error, setError] = useState(null);
    const [logs, setLogs] = useState([]);
    const logsEndRef = useRef(null);

    const addLog = (msg) => {
        setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
    };

    useEffect(() => {
        if (logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [logs]);

    const startSync = async (mode) => {
        if (isSyncing) return;

        setIsSyncing(true);
        setSyncMode(mode);
        setComplete(false);
        setError(null);
        setSections({});
        setOverallProgress(0);
        setLogs([]);
        addLog(`Starting ${mode === 'full' ? 'Full' : 'Quick'} Sync...`);

        try {
            const apiMode = mode === 'full' ? 'full' : mode === 'delta' ? 'delta' : 'incremental';
            const queryParams = new URLSearchParams({
                inventory: "true",
                sales: "true",
                mode: apiMode
            });

            const res = await fetch(`/api/sync?${queryParams.toString()}`, { method: "POST" });
            if (!res.ok) {
                let errorMsg = `Sync failed with status ${res.status}`;
                try {
                    const errData = await res.json();
                    errorMsg = errData.message || errData.error || errorMsg;
                } catch (e) { /* ignore parse error */ }
                throw new Error(errorMsg);
            }

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
                        
                        if (data.ping) continue;

                        if (data.section) {
                            setSections(prev => {
                                const next = { 
                                    ...prev, 
                                    [data.section]: { 
                                        status: data.status, 
                                        details: data.details, 
                                        progress: data.progress || 0,
                                        count: data.count || prev[data.section]?.count || 0
                                    } 
                                };
                                
                                // Calculate overall progress based on sections
                                const vals = Object.values(next);
                                if (vals.length > 0) {
                                    const total = vals.reduce((acc, s) => acc + (s.progress || 0), 0);
                                    setOverallProgress(Math.floor(total / vals.length));
                                }
                                return next;
                            });
                            
                            if (data.details) addLog(data.details);
                        }

                        if (data.status === "complete") {
                            setComplete(true);
                            setOverallProgress(100);
                            addLog("Sync completed successfully!");
                        }

                        if (data.status === "error") {
                            setError(data.message);
                            addLog(`ERROR: ${data.message}`);
                        }
                    } catch (e) {
                        console.error("Failed to parse sync line", e);
                    }
                }
            }
        } catch (err) {
            setError(err.message);
            addLog(`CRITICAL ERROR: ${err.message}`);
        } finally {
            setIsSyncing(false);
        }
    };

    return (
        <div className="sync-root">
            <header className="sync-header">
                <div className="sync-branding">
                    <img src="/kelin-logo.png" alt="Logo" style={{ width: '32px' }} />
                    <span className="sync-branding-text">
                        ACU <span className="sync-branding-accent">SYNC CENTER</span>
                    </span>
                </div>
                <div className="sync-badge">Acumatica ERP &harr; MySQL Database</div>
            </header>

            <main className="sync-main">
                <div className="sync-intro">
                    <h1 className="sync-title">Data Synchronization</h1>
                    <p className="sync-description">Keep your local MySQL database updated with the latest data from Acumatica ERP.</p>
                </div>

                {!isSyncing && !complete && !error ? (
                    <div className="qs-strategy-list" style={{ maxWidth: '700px', margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr', gap: '1rem' }}>
                        <button className="qs-card" onClick={() => startSync('delta')} style={{ padding: '1.5rem', border: '1px solid var(--border-light)' }}>
                            <div className="qs-card-icon" style={{ color: 'var(--status-warning)' }}><IconRocket /></div>
                            <div className="qs-card-info">
                                <span className="qs-card-title" style={{ fontSize: '1.1rem', color: 'var(--status-warning)' }}>Sync Today&apos;s Changes (Fast)</span>
                                <span className="qs-card-desc">Only sync items that were sold or modified today. Recommended for mid-day updates.</span>
                            </div>
                        </button>

                        <button className="qs-card" onClick={() => startSync('quick')} style={{ padding: '1.5rem', border: '1px solid var(--border-light)' }}>
                            <div className="qs-card-icon" style={{ color: 'var(--accent-primary)' }}><IconSync /></div>
                            <div className="qs-card-info">
                                <span className="qs-card-title" style={{ fontSize: '1.1rem', color: 'var(--accent-primary)' }}>Standard Incremental Sync</span>
                                <span className="qs-card-desc">Sync all changes since the last synchronization. Efficient and reliable.</span>
                            </div>
                        </button>

                        <button className="qs-card" onClick={() => startSync('full')} style={{ padding: '1.5rem', border: '1px solid var(--border-light)' }}>
                            <div className="qs-card-icon" style={{ color: 'var(--accent-secondary)' }}><IconSync /></div>
                            <div className="qs-card-info">
                                <span className="qs-card-title" style={{ fontSize: '1.1rem', color: 'var(--accent-secondary)' }}>Full Daily Refresh</span>
                                <span className="qs-card-desc">Sync all 3,000+ items and full sales history. Use for initial setup or end-of-day reporting.</span>
                            </div>
                        </button>
                    </div>
                ) : (
                    <div className="sync-status-container" style={{ maxWidth: '600px', margin: '0 auto' }}>
                        <div className={`qs-status-banner ${complete ? 'complete' : error ? 'error' : 'syncing'}`}>
                            <div style={{ 
                                width: '10px', height: '10px', borderRadius: '50%', 
                                background: complete ? 'var(--status-success)' : error ? 'var(--status-danger)' : 'var(--accent-primary)',
                                animation: !complete && !error ? 'pulse 1.5s infinite' : 'none',
                                marginRight: '10px'
                            }}></div>
                            <span style={{ flex: 1, fontWeight: '600' }}>
                                {complete ? "Synchronization Complete" : error ? "Synchronization Failed" : `Running ${syncMode === 'full' ? 'Full' : 'Quick'} Sync...`}
                            </span>
                            {complete && <IconCheck />}
                            {error && <IconAlert />}
                        </div>

                        <div style={{ textAlign: 'center', margin: '2rem 0' }}>
                            <div style={{ fontSize: '3.5rem', fontWeight: '800', color: error ? 'var(--status-danger)' : 'var(--accent-primary)' }}>{overallProgress}%</div>
                            <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>Overall Progress</div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                            {Object.entries(sections).map(([name, data]) => (
                                <div key={name} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    <div className="sync-progress-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                            <span style={{ fontSize: '0.95rem', fontWeight: '600' }}>{name}</span>
                                            {data.count > 0 && (
                                                <span style={{ 
                                                    fontSize: '0.75rem', 
                                                    background: 'var(--bg-main)', 
                                                    padding: '2px 8px', 
                                                    borderRadius: '12px', 
                                                    color: 'var(--text-secondary)',
                                                    fontWeight: '600'
                                                }}>
                                                    {data.count.toLocaleString()} {name === 'Inventory' ? 'items' : 'records'}
                                                </span>
                                            )}
                                        </div>
                                        <span style={{ fontSize: '0.9rem', fontWeight: '700', color: data.status === 'done' ? 'var(--status-success)' : 'inherit' }}>
                                            {data.progress}%
                                        </span>
                                    </div>
                                    <div className="sync-progress-track" style={{ height: '10px', background: 'var(--border-light)', borderRadius: '5px', overflow: 'hidden' }}>
                                        <div className="sync-progress-bar" style={{ 
                                            height: '100%',
                                            width: `${data.progress}%`,
                                            background: error ? 'rgba(239, 68, 68, 0.4)' : data.status === 'done' ? 'var(--status-success)' : 'var(--accent-primary)',
                                            transition: 'width 0.3s ease'
                                        }} />
                                    </div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>{data.details}</div>
                                </div>
                            ))}
                        </div>

                        <div className="qs-log-container" style={{ marginTop: '2rem', height: '150px' }}>
                            {logs.map((log, i) => (
                                <div key={i} className="qs-log-line">{log}</div>
                            ))}
                            <div ref={logsEndRef} />
                        </div>

                        {(complete || error) && (
                            <div style={{ marginTop: '2rem', display: 'flex', gap: '1rem' }}>
                                <button className="sync-start-btn" onClick={() => { setComplete(false); setError(null); setSections({}); setOverallProgress(0); setLogs([]); }} style={{ flex: 1, background: 'var(--text-secondary)' }}>
                                    Sync Again
                                </button>
                                <Link href="/dashboard" style={{ flex: 1, textDecoration: 'none' }}>
                                    <button className="sync-start-btn" style={{ width: '100%' }}>
                                        Back to Dashboard
                                    </button>
                                </Link>
                            </div>
                        )}
                    </div>
                )}

                {!isSyncing && !complete && !error && (
                    <div className="sync-footer-actions">
                        <Link href="/dashboard" className="sync-back-btn" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                            <IconChevronLeft /> Back to Dashboard
                        </Link>
                    </div>
                )}
            </main>

            <style jsx>{`
                @keyframes pulse {
                    0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.7); }
                    70% { transform: scale(1); box-shadow: 0 0 0 10px rgba(59, 130, 246, 0); }
                    100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); }
                }
            `}</style>
        </div>
    );
}
