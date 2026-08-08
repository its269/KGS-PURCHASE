"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchWithAuth } from "@/lib/api-client";
import {
  TOUR_MODULES,
  requestTourReplay,
  isTourDone,
  isTourGloballySkipped,
  syncTourPrefsFromServer,
} from "@/lib/tour-guide";
import "@/styles/admin.css";

const EMPTY = {
  currentPassword: "",
  password: "",
  confirmPassword: "",
};

export default function AccountPage() {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tourDoneMap, setTourDoneMap] = useState({});
  const [globalSkip, setGlobalSkip] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await syncTourPrefsFromServer();
      if (cancelled) return;
      const map = {};
      for (const m of TOUR_MODULES) {
        map[m.id] = isTourDone(m.id);
      }
      setTourDoneMap(map);
      setGlobalSkip(isTourGloballySkipped());
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onChange = (field) => (e) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
  };

  const handleReplayTour = (moduleId, href) => {
    requestTourReplay(moduleId);
    router.push(href);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setNotice("");

    if (!form.currentPassword || !form.password || !form.confirmPassword) {
      setError("All password fields are required.");
      return;
    }
    if (form.password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetchWithAuth("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: form.currentPassword,
          password: form.password,
          confirmPassword: form.confirmPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Failed to change password");
      setNotice("Password updated. Use your new password next time you sign in.");
      setForm(EMPTY);
    } catch (err) {
      setError(err.message || "Failed to change password");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-root">
      <header className="admin-header" data-tour="page-title">
        <div>
          <h1>Account</h1>
          <p>Change your password and replay module Tour Guides anytime.</p>
        </div>
      </header>

      {error && (
        <div className="admin-alert admin-alert--error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="admin-alert admin-alert--ok" role="status">
          {notice}
        </div>
      )}

      <section className="admin-card" data-tour="tour-replay-panel">
        <h2>Tour Guides</h2>
        <p
          style={{
            marginTop: 0,
            marginBottom: "1rem",
            color: "var(--text-secondary)",
            fontSize: "0.9rem",
            lineHeight: 1.5,
          }}
        >
          Each module can show a tour the first time you open it. If you skip a tour (or leave it mid-way), auto-tours stop on all modules. Use Replay anytime — including as an admin.
          {globalSkip ? (
            <>
              {" "}
              <strong>Auto-tours are currently off</strong> (you skipped earlier). Replay still works.
            </>
          ) : null}
        </p>
        <ul className="tour-replay-list">
          {TOUR_MODULES.map((m) => {
            const done = !!tourDoneMap[m.id];
            return (
              <li key={m.id} className="tour-replay-row">
                <div>
                  <strong>{m.label}</strong>
                  <span className="tour-replay-status">
                    {done ? "Completed / skipped" : "Not seen yet (will auto-play once)"}
                  </span>
                </div>
                <button
                  type="button"
                  className="admin-btn admin-btn--ghost"
                  onClick={() => handleReplayTour(m.id, m.href)}
                >
                  Replay
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="admin-card" data-tour="password-panel">
        <h2>Change password</h2>
        <form className="admin-form" onSubmit={handleSubmit} autoComplete="on">
          <div className="admin-form-grid">
            <label>
              Current password
              <input
                type="password"
                name="current-password"
                value={form.currentPassword}
                onChange={onChange("currentPassword")}
                required
                autoComplete="current-password"
              />
            </label>
            <label>
              New password
              <input
                type="password"
                name="new-password"
                value={form.password}
                onChange={onChange("password")}
                required
                minLength={8}
                maxLength={128}
                placeholder="At least 8 characters"
                autoComplete="new-password"
              />
            </label>
            <label>
              Confirm new password
              <input
                type="password"
                name="confirm-password"
                value={form.confirmPassword}
                onChange={onChange("confirmPassword")}
                required
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
              />
            </label>
          </div>
          <button type="submit" className="admin-btn" disabled={saving}>
            {saving ? "Updating…" : "Update password"}
          </button>
        </form>
      </section>
    </div>
  );
}
