"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
    TOUR_REPLAY_EVENT,
    TOUR_FORCE_KEY,
    getModuleById,
    getModuleIdFromPath,
    isTourDone,
    markTourDone,
    markAllToursSkipped,
    consumeTourForce,
    peekTourForce,
    requestTourReplay,
    syncTourPrefsFromServer,
} from "@/lib/tour-guide";
import "@/styles/tour-guide.css";

function targetNode(step) {
    if (!step?.target) return null;
    return document.querySelector(`[data-tour="${step.target}"]`);
}

export default function TourGuide() {
    const pathname = usePathname();
    const router = useRouter();
    const moduleId = useMemo(() => getModuleIdFromPath(pathname), [pathname]);
    const tourModule = useMemo(() => getModuleById(moduleId), [moduleId]);

    const [prefsReady, setPrefsReady] = useState(false);
    const [active, setActive] = useState(false);
    const [activeModuleId, setActiveModuleId] = useState(null);
    const [index, setIndex] = useState(0);
    const [showLauncher, setShowLauncher] = useState(false);
    const [layoutTick, setLayoutTick] = useState(0);

    const activeModule = getModuleById(activeModuleId) || tourModule;
    const activeSteps = activeModule?.steps || [];
    const step = activeSteps[index] || activeSteps[0];
    const isLast = index >= activeSteps.length - 1;

    /**
     * @param {boolean} markDone
     * @param {{ skipAll?: boolean }} [opts] — Skip / leave mid-tour → skipAll marks every module
     */
    const closeTour = useCallback(
        (markDone = true, opts = {}) => {
            const id = activeModuleId || moduleId;
            setActive(false);
            if (markDone) {
                if (opts.skipAll) markAllToursSkipped();
                else if (id) markTourDone(id);
            }
            setShowLauncher(Boolean(moduleId));
        },
        [activeModuleId, moduleId]
    );

    const openTour = useCallback((id, startAt = 0) => {
        if (!getModuleById(id)?.steps?.length) return;
        setActiveModuleId(id);
        setIndex(startAt);
        setActive(true);
        setShowLauncher(false);
        setLayoutTick((n) => n + 1);
    }, []);

    const ensureModuleThenOpen = useCallback(
        (id) => {
            const mod = getModuleById(id);
            if (!mod) return;
            const current = getModuleIdFromPath(pathname);
            if (current !== id) {
                try {
                    sessionStorage.setItem(TOUR_FORCE_KEY, id);
                } catch {
                    /* ignore */
                }
                router.push(mod.href);
                return;
            }
            openTour(id, 0);
        },
        [pathname, router, openTour]
    );

    // Load account-scoped tour prefs before auto-start (cross-device)
    useEffect(() => {
        let cancelled = false;
        (async () => {
            await syncTourPrefsFromServer();
            if (!cancelled) setPrefsReady(true);
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    // First visit only for this module; forced replay opens even if done
    useEffect(() => {
        if (typeof window === "undefined") return undefined;
        if (!prefsReady) return undefined;
        if (!moduleId || !tourModule?.steps?.length) {
            setShowLauncher(false);
            return undefined;
        }

        const forced = peekTourForce();
        if (forced === moduleId) {
            consumeTourForce();
            const t = setTimeout(() => openTour(moduleId, 0), 400);
            return () => clearTimeout(t);
        }

        const done = isTourDone(moduleId);
        if (!done) {
            const t = setTimeout(() => openTour(moduleId, 0), 500);
            return () => clearTimeout(t);
        }

        setShowLauncher(true);
        return undefined;
    }, [prefsReady, moduleId, tourModule, openTour]);

    // Leaving a module mid-tour → skip ALL modules (no auto-tour elsewhere)
    useEffect(() => {
        if (!active || !activeModuleId) return;
        if (moduleId !== activeModuleId) {
            closeTour(true, { skipAll: true });
        }
    }, [moduleId, active, activeModuleId, closeTour]);

    useEffect(() => {
        const onReplay = (e) => {
            const id = e?.detail?.moduleId || moduleId;
            if (id) ensureModuleThenOpen(id);
        };
        window.addEventListener(TOUR_REPLAY_EVENT, onReplay);
        return () => window.removeEventListener(TOUR_REPLAY_EVENT, onReplay);
    }, [ensureModuleThenOpen, moduleId]);

    useEffect(() => {
        if (!active) return undefined;
        const onResize = () => setLayoutTick((n) => n + 1);
        window.addEventListener("resize", onResize);
        window.addEventListener("scroll", onResize, true);
        return () => {
            window.removeEventListener("resize", onResize);
            window.removeEventListener("scroll", onResize, true);
        };
    }, [active]);


    useEffect(() => {
        if (!active || !step) return undefined;
        const node = targetNode(step);
        if (node) return undefined;
        const t = setTimeout(() => {
            if (isLast) closeTour(true);
            else setIndex((i) => i + 1);
        }, 80);
        return () => clearTimeout(t);
    }, [active, step, isLast, closeTour, layoutTick]);

    useEffect(() => {
        if (!active || !step) return;
        const node = targetNode(step);
        if (!node) return;
        try {
            node.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
        } catch {
            /* ignore */
        }
    }, [active, index, step, layoutTick]);

    const geometry = (() => {
        if (!active || !step) return null;
        const node = targetNode(step);
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        const pad = 8;
        const spotlight = {
            top: rect.top - pad,
            left: rect.left - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
        };

        const bw = 360;
        const bh = 220;
        const gap = 16;
        let top = 0;
        let left = 0;
        const placement = step.placement || "bottom";

        if (placement === "bottom") {
            top = rect.bottom + gap;
            left = Math.min(Math.max(16, rect.left), window.innerWidth - bw - 16);
        } else if (placement === "top") {
            top = rect.top - bh - gap;
            left = Math.min(Math.max(16, rect.left), window.innerWidth - bw - 16);
        } else if (placement === "right") {
            top = Math.max(16, rect.top);
            left = rect.right + gap;
        } else {
            top = Math.max(16, rect.top);
            left = rect.left - bw - gap;
        }

        top = Math.min(Math.max(12, top), window.innerHeight - bh - 12);
        left = Math.min(Math.max(12, left), window.innerWidth - bw - 12);

        return { spotlight, bubble: { top, left }, placement };
    })();

    const onNext = () => {
        if (isLast) {
            closeTour(true);
            return;
        }
        setIndex((i) => i + 1);
        setLayoutTick((n) => n + 1);
    };

    const onBack = () => {
        if (index <= 0) return;
        setIndex((i) => i - 1);
        setLayoutTick((n) => n + 1);
    };

    const replayCurrent = () => {
        if (!moduleId) return;
        requestTourReplay(moduleId);
        ensureModuleThenOpen(moduleId);
    };

    return (
        <>
            {showLauncher && !active && moduleId ? (
                <button
                    type="button"
                    className="tour-launcher"
                    onClick={replayCurrent}
                    aria-label={`Replay ${tourModule?.label || "module"} tour guide`}
                    title="Tour Guide"
                >
                    <span className="tour-launcher-icon" aria-hidden="true">
                        ?
                    </span>
                    <span className="tour-launcher-label">Tour Guide</span>
                </button>
            ) : null}

            {active && geometry && step && (
                <div className="tour-root">
                    <div className="tour-scrim" aria-hidden="true">
                        <div
                            className="tour-spotlight"
                            style={{
                                top: geometry.spotlight.top,
                                left: geometry.spotlight.left,
                                width: geometry.spotlight.width,
                                height: geometry.spotlight.height,
                            }}
                        />
                    </div>
                    <div
                        className="tour-bubble"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="tour-title"
                        aria-describedby="tour-body"
                        data-placement={geometry.placement}
                        style={{ top: geometry.bubble.top, left: geometry.bubble.left }}
                    >
                        <div className="tour-guide-row">
                            <div className="tour-avatar" aria-hidden="true" />
                            <div className="tour-guide-meta">
                                <strong>{activeModule?.label || "Guide"}</strong>
                                <span>
                                    Tip {index + 1} of {activeSteps.length}
                                </span>
                            </div>
                        </div>
                        <h2 className="tour-title" id="tour-title">
                            {step.title}
                        </h2>
                        <p className="tour-body" id="tour-body">
                            {step.body}
                        </p>
                        <div className="tour-progress" aria-hidden="true">
                            {activeSteps.map((_, i) => (
                                <i key={i} className={i <= index ? "on" : ""} />
                            ))}
                        </div>
                        <div className="tour-actions">
                            <button
                                type="button"
                                className="tour-btn tour-btn-skip"
                                onClick={() => closeTour(true, { skipAll: true })}
                            >
                                Skip tutorial
                            </button>
                            <div className="tour-actions-right">
                                <button
                                    type="button"
                                    className="tour-btn"
                                    onClick={onBack}
                                    disabled={index === 0}
                                >
                                    Back
                                </button>
                                <button type="button" className="tour-btn tour-btn-primary" onClick={onNext}>
                                    {isLast ? "Finish" : "Next"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
