"use client";

import { useState, useEffect } from "react";
import { DataCache } from "@/lib/data-cache";
import { fetchWithAuth } from "@/lib/api-client";
import { DIMENSION_FIELDS } from "@/lib/item-dimensions";
import "@/styles/inventory-detail.css";

const IconClose = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
);

const IconInfo = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
);

function stockStatus(onHand) {
    if (onHand <= 0) return { label: "Out of Stock", cls: "status-out" };
    if (onHand <= 10) return { label: "Low Stock", cls: "status-low" };
    return { label: "In Stock", cls: "status-in" };
}

function fmtDate(d) {
    if (!d) return "—";
    const date = new Date(d);
    if (isNaN(date.getTime())) return d;
    return date.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}

function dimObjectFromApi(dim) {
    if (!dim) {
        return { pcs_per_box: "", length_m: "", height_m: "", width_m: "", weight_kg: "", cbm: "" };
    }
    const out = {};
    for (const { key } of DIMENSION_FIELDS) {
        out[key] = dim[key] != null && dim[key] !== "" ? String(dim[key]) : "";
    }
    return out;
}

function dimPayloadFromForm(form) {
    const out = {};
    for (const { key } of DIMENSION_FIELDS) {
        const v = form[key];
        out[key] = v === "" || v === null || v === undefined ? null : Number(v);
    }
    return out;
}

export default function InventoryDetailModal({ inventoryId, onClose }) {
    const [detail, setDetail] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [notes, setNotes] = useState("");
    const [savingNotes, setSavingNotes] = useState(false);
    const [dimensions, setDimensions] = useState({});
    const [savingDims, setSavingDims] = useState(false);
    const [dimSaved, setDimSaved] = useState(false);

    useEffect(() => {
        if (!inventoryId) return;

        const cacheKey = `stock_detail_${inventoryId}`;
        let cancelled = false;

        const cached = DataCache.get(cacheKey);
        if (cached) {
            setDetail(cached);
            setNotes(cached.annotations?.internal_notes || "");
            setDimensions(dimObjectFromApi(cached.dimensions));
            setLoading(false);
            setError(null);
        } else {
            setLoading(true);
            setDetail(null);
            setError(null);
        }

        const controller = new AbortController();

        (async () => {
            try {
                const r = await fetchWithAuth(`/api/stock-items/${encodeURIComponent(inventoryId)}`, {
                    signal: controller.signal,
                });
                if (cancelled) return;
                const d = await r.json();
                if (!r.ok) {
                    throw new Error(d.error || d.message || "Failed to load details");
                }
                setDetail(d);
                setNotes(d.annotations?.internal_notes || "");
                setDimensions(dimObjectFromApi(d.dimensions));
                setError(null);
                DataCache.set(cacheKey, d);
            } catch (err) {
                if (cancelled) return;
                const aborted =
                    err.name === "AbortError" ||
                    String(err.message || "").toLowerCase().includes("abort");
                if (!aborted) {
                    setError(err.message || "Failed to load details.");
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [inventoryId]);

    const handleSaveNotes = async () => {
        setSavingNotes(true);
        try {
            await fetchWithAuth("/api/annotations", {
                method: "POST",
                body: JSON.stringify({
                    module: "inventory",
                    refId: inventoryId,
                    fieldKey: "internal_notes",
                    fieldValue: notes
                })
            });
            // Update cache
            const cacheKey = `stock_detail_${inventoryId}`;
            const cached = DataCache.get(cacheKey);
            if (cached) {
                DataCache.set(cacheKey, {
                    ...cached,
                    annotations: { ...(cached.annotations || {}), internal_notes: notes }
                });
            }
        } catch (err) {
            console.error("Failed to save notes", err);
        } finally {
            setSavingNotes(false);
        }
    };

    const handleDimChange = (key, value) => {
        setDimSaved(false);
        setDimensions((prev) => ({ ...prev, [key]: value }));
    };

    const handleSaveDimensions = async () => {
        setSavingDims(true);
        setDimSaved(false);
        try {
            const res = await fetchWithAuth(`/api/stock-items/${encodeURIComponent(inventoryId)}/dimensions`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(dimPayloadFromForm(dimensions)),
            });
            if (!res.ok) throw new Error("Save failed");
            const data = await res.json();
            const saved = dimObjectFromApi(data.dimensions);
            setDimensions(saved);
            setDimSaved(true);
            const cacheKey = `stock_detail_${inventoryId}`;
            const cached = DataCache.get(cacheKey);
            if (cached) {
                DataCache.set(cacheKey, { ...cached, dimensions: data.dimensions });
            }
        } catch (err) {
            console.error("Failed to save dimensions", err);
        } finally {
            setSavingDims(false);
        }
    };

    if (!inventoryId) return null;

    const totalStatus = detail ? stockStatus(detail.totalOnHand) : null;

    return (
        <div className="idm-overlay" onClick={onClose}>
            <div className="idm-modal" onClick={e => e.stopPropagation()}>
                <button className="idm-close-btn" onClick={onClose} aria-label="Close">
                    <IconClose />
                </button>

                {loading && (
                    <div className="idm-loading">
                        <div className="idm-spinner"></div>
                        <p>Fetching item details...</p>
                    </div>
                )}

                {error && (
                    <div className="idm-error">
                        <p>{error}</p>
                        <button onClick={() => window.location.reload()}>Retry</button>
                    </div>
                )}

                {detail && !loading && (
                    <div className="idm-content">
                        {/* Header Section */}
                        <header className="idm-header">
                            <div className="idm-top-row">
                                <span className="idm-badge-id">{inventoryId}</span>
                                <span className="idm-badge-class">{detail.itemClass}</span>
                            </div>
                            <h2 className="idm-title">{detail.description}</h2>
                            
                            <div className="idm-source-row">
                                {detail.source === "acumatica" && (
                                    <span className="idm-source idm-source-live">● Live from Acumatica</span>
                                )}
                                {detail.source === "mysql" && (
                                    <span className="idm-source idm-source-live">● Live from MySQL</span>
                                )}
                                {detail.source === "supabase" && (
                                    <span className="idm-source idm-source-cache">● From local database</span>
                                )}
                                {detail.notice && (
                                    <span className="idm-source idm-source-warn">● {detail.notice}</span>
                                )}
                            </div>
                        </header>

                        {/* Summary Cards */}
                        <div className="idm-grid">
                            <div className="idm-card">
                                <span className="idm-card-label">Total On Hand</span>
                                <div className="idm-card-value-group">
                                    <span className="idm-card-value">{(Number(detail.totalOnHand) || 0).toLocaleString()}</span>
                                    {totalStatus && (
                                        <span className={`idm-status-pill ${totalStatus.cls}`}>{totalStatus.label}</span>
                                    )}
                                </div>
                            </div>
                            <div className="idm-card">
                                <span className="idm-card-label">Total Available</span>
                                <div className="idm-card-value-group">
                                    <span className="idm-card-value">{(Number(detail.totalAvailable) || 0).toLocaleString()}</span>
                                    <span className="idm-card-label" style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>Units</span>
                                </div>
                            </div>
                            <div className="idm-card">
                                <span className="idm-card-label">Unit Price</span>
                                <div className="idm-card-value-group">
                                    <span className="idm-card-value">₱{(Number(detail.unitPrice) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                </div>
                            </div>
                            <div className="idm-card">
                                <span className="idm-card-label">Base Unit</span>
                                <div className="idm-card-value-group">
                                    <span className="idm-card-value" style={{ fontSize: '1.25rem' }}>{detail.baseUnit || "—"}</span>
                                </div>
                            </div>
                        </div>

                        {/* Metadata row */}
                        <div className="idm-meta-bar">
                            <div className="idm-meta-item">
                                <span className="idm-meta-label">Status:</span>
                                <span className="idm-meta-value" style={{ fontWeight: '700' }}>{detail.itemStatus}</span>
                            </div>
                            <div className="idm-meta-item">
                                <span className="idm-meta-label">Class:</span>
                                <span className="idm-meta-value">{detail.itemClass}</span>
                            </div>
                            <div className="idm-meta-item">
                                <span className="idm-meta-label">Type:</span>
                                <span className="idm-meta-value">{detail.type || "—"}</span>
                            </div>
                            <div className="idm-meta-item">
                                <span className="idm-meta-label">Posting Class:</span>
                                <span className="idm-meta-value">{detail.postingClass || "—"}</span>
                            </div>
                            <div className="idm-meta-item">
                                <span className="idm-meta-label">Def. Warehouse:</span>
                                <span className="idm-meta-value">{detail.defaultWarehouse || "—"}</span>
                            </div>
                            {detail.lastSync && (
                                <div className="idm-meta-item">
                                    <span className="idm-meta-label">Last Sync:</span>
                                    <span className="idm-meta-value">{fmtDate(detail.lastSync)}</span>
                                </div>
                            )}
                        </div>

                        {/* Packaging dimensions */}
                        <div className="idm-section">
                            <h3 className="idm-section-title">Packaging Dimensions</h3>
                            <p className="idm-dim-hint">Per-box measurements for this item (stored in this app only).</p>
                            <div className="idm-dim-grid">
                                {DIMENSION_FIELDS.map(({ key, label, step }) => (
                                    <label key={key} className="idm-dim-field">
                                        <span className="idm-dim-label">{label}</span>
                                        <input
                                            type="number"
                                            step={step}
                                            min="0"
                                            className="idm-dim-input"
                                            value={dimensions[key] ?? ""}
                                            onChange={(e) => handleDimChange(key, e.target.value)}
                                            placeholder="—"
                                        />
                                    </label>
                                ))}
                            </div>
                            <div className="idm-dim-actions">
                                {dimSaved && <span className="idm-dim-saved">Saved</span>}
                                <button
                                    type="button"
                                    className="db-action-btn"
                                    onClick={handleSaveDimensions}
                                    disabled={savingDims}
                                    style={{ height: "32px", fontSize: "0.75rem", padding: "0 1rem" }}
                                >
                                    {savingDims ? "Saving..." : "Save Dimensions"}
                                </button>
                            </div>
                        </div>

                        {/* Internal Notes Section */}
                        <div className="idm-section">
                            <h3 className="idm-section-title">Internal Notes & Annotations</h3>
                            <div style={{ background: 'var(--bg-main)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--border-light)' }}>
                                <textarea
                                    className="idm-notes-area"
                                    placeholder="Add internal notes about this item (e.g., replacement info, quality notes)..."
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    style={{ 
                                        width: '100%', 
                                        minHeight: '80px', 
                                        background: 'transparent', 
                                        border: 'none', 
                                        color: 'var(--text-primary)',
                                        fontSize: '0.9rem',
                                        resize: 'vertical',
                                        outline: 'none'
                                    }}
                                />
                                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                                    <button 
                                        className="db-action-btn"
                                        onClick={handleSaveNotes}
                                        disabled={savingNotes}
                                        style={{ height: '32px', fontSize: '0.75rem', padding: '0 1rem' }}
                                    >
                                        {savingNotes ? "Saving..." : "Save Notes"}
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Warehouse Breakdown */}
                        <div className="idm-section">
                            <h3 className="idm-section-title">Stock by Warehouse / Branch</h3>
                            <div className="idm-table-container">
                                <table className="idm-table">
                                    <thead>
                                        <tr>
                                            <th>Warehouse</th>
                                            <th className="idm-txt-right">On Hand</th>
                                            <th className="idm-txt-right">Available</th>
                                            <th>Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {detail.branches && detail.branches.length === 0 ? (
                                            <tr><td colSpan={4} className="idm-empty">No warehouse data available.</td></tr>
                                        ) : (
                                            (detail.branches || []).map(b => {
                                                const s = stockStatus(b.onHand);
                                                return (
                                                    <tr key={b.branchId || b.siteId}>
                                                        <td><strong>{b.branchId || b.siteId}</strong></td>
                                                        <td className="idm-txt-right idm-txt-bold">{Number(b.onHand).toLocaleString()}</td>
                                                        <td className="idm-txt-right">{Number(b.available).toLocaleString()}</td>
                                                        <td><span className={`idm-status-pill idm-status-pill-sm ${s.cls}`}>{s.label}</span></td>
                                                    </tr>
                                                );
                                            })
                                        )}
                                    </tbody>
                                    <tfoot>
                                        <tr>
                                            <td>TOTAL</td>
                                            <td className="idm-txt-right">{Number(detail.totalOnHand).toLocaleString()}</td>
                                            <td className="idm-txt-right">{Number(detail.totalAvailable).toLocaleString()}</td>
                                            <td></td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
