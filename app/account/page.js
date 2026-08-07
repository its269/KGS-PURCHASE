"use client";

import { useState } from "react";
import { fetchWithAuth } from "@/lib/api-client";
import "@/styles/admin.css";

const EMPTY = {
  currentPassword: "",
  password: "",
  confirmPassword: "",
};

export default function AccountPage() {
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const onChange = (field) => (e) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
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
      <header className="admin-header">
        <div>
          <h1>Account</h1>
          <p>Change the password for your KGS Purchasing login.</p>
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

      <section className="admin-card">
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
