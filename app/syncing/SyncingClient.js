"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { withBasePath } from "@/lib/base-path";
import TourGuide from "@/components/TourGuide";
import "@/styles/sync.css";

const IconSync = () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />
        <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 16h5v5" />
    </svg>
);

const IconZap = () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
);

const IconCheck = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="20 6 9 17 4 12" />
    </svg>
);

const IconAlert = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
);

const IconChevronLeft = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="15 18 9 12 15 6" />
    </svg>
);

function formatMode(mode) {
    if (mode === "incremental" || mode === "delta" || mode === "quick") return "Quick";
    if (mode === "full") return "Full";
    if (mode === "import") return "Import";
    return mode || "—";
}

function statusClass(status) {
    if (status === "completed") return "is-ok";
    if (status === "started") return "is-run";
    return "is-err";
}

const IconUpload = () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
);

export default function SyncingClient() {
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncMode, setSyncMode] = useState(null);
    const [sections, setSections] = useState({});
    const [overallProgress, setOverallProgress] = useState(0);
    const [complete, setComplete] = useState(false);
    const [error, setError] = useState(null);
    const [logs, setLogs] = useState([]);
    const [history, setHistory] = useState([]);
    const [loadingHistory, setLoadingHistory] = useState(true);
    const [importFile, setImportFile] = useState(null);
    const [showImport, setShowImport] = useState(false);
    const logsEndRef = useRef(null);
    const fileInputRef = useRef(null);

    const addLog = (msg) => {
        setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
    };

    const fetchHistory = useCallback(async () => {
        setLoadingHistory(true);
        try {
            const res = await fetch("/api/sync");
            if (res.ok) {
                const data = await res.json();
                setHistory(data || []);
            }
        } catch (err) {
            console.error("Failed to fetch sync history", err);
        } finally {
            setLoadingHistory(false);
        }
    }, []);

    useEffect(() => {
        fetchHistory();
    }, [fetchHistory]);

    useEffect(() => {
        if (logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [logs]);

    const resetToChooser = () => {
        setComplete(false);
        setError(null);
        setSections({});
        setOverallProgress(0);
        setLogs([]);
        setSyncMode(null);
        setShowImport(false);
        setImportFile(null);
    };

    const startImport = async () => {
        if (isSyncing || !importFile) return;

        setIsSyncing(true);
        setSyncMode("import");
        setShowImport(false);
        setComplete(false);
        setError(null);
        setSections({
            Inventory: { status: "run", details: `Uploading ${importFile.name}…`, progress: 15, count: 0 },
        });
        setOverallProgress(15);
        setLogs([]);
        addLog(`Importing Acumatica export: ${importFile.name}`);

        try {
            const form = new FormData();
            form.append("file", importFile);
            const res = await fetch("/api/sync/import", { method: "POST", body: form });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || `Import failed (${res.status})`);

            setSections({
                Inventory: {
                    status: "done",
                    details: data.message,
                    progress: 100,
                    count: data.catalogs || 0,
                },
            });
            setOverallProgress(100);
            setComplete(true);
            addLog(data.message || "Import completed.");
            if (data.detected?.columns) {
                addLog(`Detected columns: ${data.detected.columns.join(", ")}`);
            }
            fetchHistory();
        } catch (err) {
            setError(err.message);
            addLog(`ERROR: ${err.message}`);
            fetchHistory();
        } finally {
            setIsSyncing(false);
            setImportFile(null);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const startSync = async (mode) => {
        if (isSyncing) return;

        setIsSyncing(true);
        setSyncMode(mode);
        setComplete(false);
        setError(null);
        setSections({});
        setOverallProgress(0);
        setLogs([]);
        addLog(`Starting ${mode === "full" ? "Full" : "Quick"} Sync…`);

        try {
            const apiMode = mode === "full" ? "full" : "incremental";
            const queryParams = new URLSearchParams({
                inventory: "true",
                sales: "true",
                mode: apiMode,
            });

            const res = await fetch(`/api/sync?${queryParams.toString()}`, { method: "POST" });
            if (!res.ok) {
                let errorMsg = `Sync failed with status ${res.status}`;
                try {
                    const errData = await res.json();
                    errorMsg = errData.message || errData.error || errorMsg;
                } catch {
                    /* ignore */
                }
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
                            setSections((prev) => {
                                const next = {
                                    ...prev,
                                    [data.section]: {
                                        status: data.status,
                                        details: data.details,
                                        progress: data.progress || 0,
                                        count: data.count || prev[data.section]?.count || 0,
                                    },
                                };
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
                            fetchHistory();
                        }

                        if (data.status === "error") {
                            setError(data.message);
                            addLog(`ERROR: ${data.message}`);
                            fetchHistory();
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

    const idle = !isSyncing && !complete && !error;
    const sectionEntries = Object.entries(sections);

    return (
        <div className="sync-root">
            <TourGuide />
            <header className="sync-topbar">
                <div className="sync-topbar-brand">
                    <img
                        src={withBasePath("/kelin-logo.png")}
                        alt="KGS"
                        className="sync-topbar-logo"
                    />
                    <div>
                        <p className="sync-topbar-eyebrow">KGS Purchase</p>
                        <h1 className="sync-topbar-title">
                            Sync <span>Center</span>
                        </h1>
                    </div>
                </div>
                <div className="sync-topbar-meta">
                    <span className="sync-pill">Acumatica → MySQL</span>
                    <Link href="/dashboard" className="sync-link-back">
                        <IconChevronLeft /> Dashboard
                    </Link>
                </div>
            </header>

            <main className="sync-shell">
                {idle ? (
                    <section className="sync-hero" aria-labelledby="sync-hero-title" data-tour="page-title">
                        <p className="sync-eyebrow">Data synchronization</p>
                        <h2 id="sync-hero-title" className="sync-hero-title">
                            Keep MySQL current with Acumatica
                        </h2>
                        <p className="sync-hero-copy">
                            Choose a sync mode. Quick pulls only new and changed records;
                            Full rebuilds from Acumatica online; Import loads an Excel/CSV
                            export when online Full Sync is unreliable.
                        </p>

                        <div className="sync-mode-grid" role="group" aria-label="Sync modes" data-tour="sync-modes">
                            <button
                                type="button"
                                className="sync-mode-card is-quick"
                                onClick={() => startSync("quick")}
                            >
                                <div className="sync-mode-icon" aria-hidden="true">
                                    <IconZap />
                                </div>
                                <div className="sync-mode-body">
                                    <div className="sync-mode-head">
                                        <span className="sync-mode-name">Quick Sync</span>
                                        <span className="sync-mode-badge">Recommended</span>
                                    </div>
                                    <p className="sync-mode-desc">
                                        Sync only new and changed records since the last run.
                                        Faster for daily updates — skips data MySQL already has.
                                    </p>
                                    <span className="sync-mode-cta">Start Quick Sync →</span>
                                </div>
                            </button>

                            <button
                                type="button"
                                className="sync-mode-card is-full"
                                onClick={() => startSync("full")}
                            >
                                <div className="sync-mode-icon" aria-hidden="true">
                                    <IconSync />
                                </div>
                                <div className="sync-mode-body">
                                    <div className="sync-mode-head">
                                        <span className="sync-mode-name">Full Sync</span>
                                        <span className="sync-mode-badge is-muted">Complete</span>
                                    </div>
                                    <p className="sync-mode-desc">
                                        Full inventory, stock levels, sales history, and related data.
                                        Use when you need a complete refresh or to fix accuracy.
                                    </p>
                                    <span className="sync-mode-cta">Start Full Sync →</span>
                                </div>
                            </button>

                            <button
                                type="button"
                                className="sync-mode-card is-import"
                                onClick={() => setShowImport(true)}
                            >
                                <div className="sync-mode-icon" aria-hidden="true">
                                    <IconUpload />
                                </div>
                                <div className="sync-mode-body">
                                    <div className="sync-mode-head">
                                        <span className="sync-mode-name">Import File</span>
                                        <span className="sync-mode-badge is-muted">Offline</span>
                                    </div>
                                    <p className="sync-mode-desc">
                                        Upload an Acumatica Stock Items Excel/CSV (Inventory ID,
                                        Description, Item Class, Default Price, etc.). For qty by
                                        warehouse, use an Inventory Summary export instead.
                                    </p>
                                    <span className="sync-mode-cta">Choose file →</span>
                                </div>
                            </button>
                        </div>

                        {showImport ? (
                            <div className="sync-import-panel" role="region" aria-label="Import Acumatica file">
                                <h3>Import Acumatica export</h3>
                                <p>
                                    Your Stock Items export works here (Inventory ID, Description, Type,
                                    Item Class, Default Warehouse, Base Unit, Default Price, Item Status).
                                    Catalog fields are updated; existing on-hand quantities are kept unless
                                    the file also has qty columns.
                                </p>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                                    onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                                />
                                <div className="sync-import-actions">
                                    <button
                                        type="button"
                                        className="sync-btn sync-btn-ghost"
                                        onClick={() => {
                                            setShowImport(false);
                                            setImportFile(null);
                                        }}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        className="sync-btn sync-btn-primary"
                                        disabled={!importFile || isSyncing}
                                        onClick={startImport}
                                    >
                                        {importFile ? `Import ${importFile.name}` : "Select a file first"}
                                    </button>
                                </div>
                            </div>
                        ) : null}
                    </section>
                ) : (
                    <section
                        className={`sync-run ${error ? "is-error" : complete ? "is-done" : "is-active"}`}
                        aria-live="polite"
                    >
                        <div className={`sync-run-banner ${error ? "error" : complete ? "complete" : "syncing"}`}>
                            <span className="sync-run-dot" aria-hidden="true" />
                            <div className="sync-run-banner-text">
                                <strong>
                                    {complete
                                        ? "Synchronization complete"
                                        : error
                                        ? "Synchronization failed"
                                        : `Running ${
                                              syncMode === "full"
                                                  ? "Full"
                                                  : syncMode === "import"
                                                    ? "Import"
                                                    : "Quick"
                                          } Sync`}
                                </strong>
                                {!complete && !error ? (
                                    <span>Streaming progress from Acumatica…</span>
                                ) : error ? (
                                    <span>{error}</span>
                                ) : (
                                    <span>MySQL is up to date with the latest pull.</span>
                                )}
                            </div>
                            {complete ? <IconCheck /> : null}
                            {error ? <IconAlert /> : null}
                        </div>

                        <div className="sync-run-score">
                            <div
                                className="sync-run-pct"
                                style={{
                                    "--sync-pct": `${overallProgress}%`,
                                    color: error
                                        ? "var(--status-danger)"
                                        : complete
                                        ? "var(--status-success)"
                                        : "var(--accent-primary)",
                                }}
                            >
                                {overallProgress}
                                <span>%</span>
                            </div>
                            <p className="sync-run-pct-label">Overall progress</p>
                            <div className="sync-run-ring-track" aria-hidden="true">
                                <div
                                    className="sync-run-ring-fill"
                                    style={{
                                        width: `${overallProgress}%`,
                                        background: error
                                            ? "var(--status-danger)"
                                            : complete
                                            ? "var(--status-success)"
                                            : "var(--accent-primary)",
                                    }}
                                />
                            </div>
                        </div>

                        {sectionEntries.length > 0 ? (
                            <div className="sync-sections">
                                {sectionEntries.map(([name, data]) => (
                                    <div key={name} className="sync-section-row">
                                        <div className="sync-section-head">
                                            <div className="sync-section-title">
                                                <span>{name}</span>
                                                {data.count > 0 ? (
                                                    <span className="sync-section-count">
                                                        {data.count.toLocaleString()}{" "}
                                                        {name === "Inventory" ? "items" : "records"}
                                                    </span>
                                                ) : null}
                                            </div>
                                            <span
                                                className={`sync-section-pct ${
                                                    data.status === "done" ? "is-done" : ""
                                                }`}
                                            >
                                                {data.progress}%
                                            </span>
                                        </div>
                                        <div className="sync-section-track">
                                            <div
                                                className={`sync-section-bar ${
                                                    error
                                                        ? "is-error"
                                                        : data.status === "done"
                                                        ? "is-done"
                                                        : ""
                                                }`}
                                                style={{ width: `${data.progress}%` }}
                                            />
                                        </div>
                                        {data.details ? (
                                            <p className="sync-section-detail">{data.details}</p>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        ) : null}

                        <div className="sync-log" role="log" aria-label="Sync log">
                            <div className="sync-log-head">Live log</div>
                            <div className="sync-log-body">
                                {logs.length === 0 ? (
                                    <div className="sync-log-line is-muted">Waiting for events…</div>
                                ) : (
                                    logs.map((log, i) => (
                                        <div key={i} className="sync-log-line">
                                            {log}
                                        </div>
                                    ))
                                )}
                                <div ref={logsEndRef} />
                            </div>
                        </div>

                        {(complete || error) && (
                            <div className="sync-run-actions">
                                <button type="button" className="sync-btn sync-btn-ghost" onClick={resetToChooser}>
                                    Sync again
                                </button>
                                <Link href="/dashboard" className="sync-btn sync-btn-primary">
                                    Back to dashboard
                                </Link>
                            </div>
                        )}
                    </section>
                )}

                {!isSyncing && (
                    <section className="sync-history" aria-labelledby="sync-history-title" data-tour="main-table">
                        <div className="sync-history-head">
                            <h2 id="sync-history-title">
                                <IconSync /> Recent sync history
                            </h2>
                        </div>

                        <div className="sync-history-panel">
                            <table className="sync-history-table">
                                <thead>
                                    <tr>
                                        <th>Time</th>
                                        <th>Mode</th>
                                        <th>Section</th>
                                        <th>Status</th>
                                        <th className="is-num">Records</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {loadingHistory ? (
                                        <tr>
                                            <td colSpan={5} className="sync-history-empty">
                                                Loading history…
                                            </td>
                                        </tr>
                                    ) : history.length === 0 ? (
                                        <tr>
                                            <td colSpan={5} className="sync-history-empty">
                                                No sync history yet. Run a Quick or Full Sync to get started.
                                            </td>
                                        </tr>
                                    ) : (
                                        history.map((h) => (
                                            <tr key={h.id}>
                                                <td>{new Date(h.timestamp).toLocaleString()}</td>
                                                <td>
                                                    <span className="sync-mode-tag">{formatMode(h.mode)}</span>
                                                </td>
                                                <td>{h.section}</td>
                                                <td>
                                                    <span className={`sync-status-tag ${statusClass(h.status)}`}>
                                                        {h.status}
                                                    </span>
                                                </td>
                                                <td className="is-num">
                                                    {h.records > 0 ? h.records.toLocaleString() : "—"}
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </section>
                )}
            </main>
        </div>
    );
}
