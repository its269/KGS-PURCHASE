"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { fetchWithAuth } from "@/lib/api-client";
import "@/styles/admin.css";

const EMPTY_FORM = {
    username: "",
    password: "",
    fullName: "",
    email: "",
    role: "user",
    active: true,
};

export default function AdminPage() {
    const router = useRouter();
    const [me, setMe] = useState(null);
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [form, setForm] = useState(EMPTY_FORM);
    const [editingId, setEditingId] = useState(null);
    const [saving, setSaving] = useState(false);
    const [profile, setProfile] = useState({ username: "", fullName: "", email: "" });
    const [savingProfile, setSavingProfile] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const [sessionRes, usersRes] = await Promise.all([
                fetchWithAuth("/api/auth/session"),
                fetchWithAuth("/api/admin/users"),
            ]);

            if (sessionRes.status === 401) {
                router.replace("/signin?expired=1");
                return;
            }
            const sessionData = await sessionRes.json();
            if (!sessionData?.user || sessionData.user.role !== "admin") {
                router.replace("/dashboard");
                return;
            }
            setMe(sessionData.user);
            setProfile({
                username: sessionData.user.username || "",
                fullName: sessionData.user.fullName || "",
                email: sessionData.user.email || "",
            });

            if (!usersRes.ok) {
                const body = await usersRes.json().catch(() => ({}));
                throw new Error(body.message || "Failed to load users");
            }
            const data = await usersRes.json();
            setUsers(data.users || []);
        } catch (err) {
            setError(err.message || "Failed to load admin data");
        } finally {
            setLoading(false);
        }
    }, [router]);

    useEffect(() => {
        load();
    }, [load]);

    const resetForm = () => {
        setEditingId(null);
        setForm(EMPTY_FORM);
    };

    const startEdit = (user) => {
        setEditingId(user.id);
        setForm({
            username: user.username || "",
            password: "",
            fullName: user.fullName || "",
            email: user.email || "",
            role: user.role || "user",
            active: user.active !== false,
        });
        setNotice("");
        setError("");
    };

    const handleSaveUser = async (e) => {
        e.preventDefault();
        setSaving(true);
        setError("");
        setNotice("");
        try {
            const payload = {
                username: form.username,
                fullName: form.fullName,
                email: form.email,
                role: form.role,
                active: form.active,
            };
            if (form.password) payload.password = form.password;

            let res;
            if (editingId) {
                res = await fetchWithAuth(`/api/admin/users/${editingId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                });
            } else {
                if (!form.password) throw new Error("Password is required for new users.");
                payload.password = form.password;
                res = await fetchWithAuth("/api/admin/users", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                });
            }

            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || "Save failed");

            setNotice(editingId ? "User updated." : "User created.");
            resetForm();
            await load();
            if (data.user?.id === me?.id) {
                localStorage.setItem("userName", data.user.fullName || data.user.username);
                localStorage.setItem("userRole", data.user.role);
            }
        } catch (err) {
            setError(err.message || "Save failed");
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (user) => {
        if (!window.confirm(`Delete user "${user.username}"? This cannot be undone.`)) return;
        setError("");
        setNotice("");
        try {
            const res = await fetchWithAuth(`/api/admin/users/${user.id}`, { method: "DELETE" });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || "Delete failed");
            setNotice(`Deleted ${user.username}.`);
            if (editingId === user.id) resetForm();
            await load();
        } catch (err) {
            setError(err.message || "Delete failed");
        }
    };

    const handleSaveProfile = async (e) => {
        e.preventDefault();
        setSavingProfile(true);
        setError("");
        setNotice("");
        try {
            const payload = {
                username: profile.username,
                fullName: profile.fullName,
                email: profile.email,
            };
            const res = await fetchWithAuth("/api/auth/profile", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || "Profile update failed");
            setNotice("Your profile was updated.");
            localStorage.setItem("userName", data.user.fullName || data.user.username);
            localStorage.setItem("userRole", data.user.role);
            setMe(data.user);
            await load();
        } catch (err) {
            setError(err.message || "Profile update failed");
        } finally {
            setSavingProfile(false);
        }
    };

    if (loading) {
        return (
            <div className="admin-root">
                <div className="admin-loading">Loading admin…</div>
            </div>
        );
    }

    return (
        <div className="admin-root">
            <header className="admin-header" data-tour="page-title">
                <div>
                    <h1>Admin — User Accounts</h1>
                    <p>Create and manage local logins for KGS Purchasing. ERP data still uses system Acumatica credentials.</p>
                </div>
            </header>

            {error && <div className="admin-alert admin-alert--error" role="alert">{error}</div>}
            {notice && <div className="admin-alert admin-alert--ok" role="status">{notice}</div>}

            <section className="admin-card">
                <h2>My account</h2>
                <p className="admin-header-hint">
                    To change your password, open{" "}
                    <Link href="/account">Account</Link> in the sidebar.
                </p>
                <form className="admin-form" onSubmit={handleSaveProfile}>
                    <div className="admin-form-grid">
                        <label>
                            Username
                            <input
                                value={profile.username}
                                onChange={(e) => setProfile((p) => ({ ...p, username: e.target.value }))}
                                required
                                autoComplete="username"
                            />
                        </label>
                        <label>
                            Full name
                            <input
                                value={profile.fullName}
                                onChange={(e) => setProfile((p) => ({ ...p, fullName: e.target.value }))}
                            />
                        </label>
                        <label>
                            Email
                            <input
                                type="email"
                                value={profile.email}
                                onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))}
                            />
                        </label>
                    </div>
                    <button type="submit" className="admin-btn" disabled={savingProfile}>
                        {savingProfile ? "Saving…" : "Save my account"}
                    </button>
                </form>
            </section>

            <section className="admin-card" data-tour="toolbar">
                <div className="admin-card-head">
                    <h2>{editingId ? "Edit user" : "Create user"}</h2>
                    {editingId && (
                        <button type="button" className="admin-btn admin-btn--ghost" onClick={resetForm}>
                            Cancel edit
                        </button>
                    )}
                </div>
                <form className="admin-form" onSubmit={handleSaveUser}>
                    <div className="admin-form-grid">
                        <label>
                            Username
                            <input
                                value={form.username}
                                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                                required
                            />
                        </label>
                        <label>
                            Password {editingId ? "(optional)" : ""}
                            <input
                                type="password"
                                value={form.password}
                                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                                placeholder={editingId ? "Leave blank to keep" : "Min 8 characters"}
                                required={!editingId}
                                autoComplete="new-password"
                            />
                        </label>
                        <label>
                            Full name
                            <input
                                value={form.fullName}
                                onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
                            />
                        </label>
                        <label>
                            Email
                            <input
                                type="email"
                                value={form.email}
                                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                            />
                        </label>
                        <label>
                            Role
                            <select
                                value={form.role}
                                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                            >
                                <option value="user">User</option>
                                <option value="admin">Admin</option>
                            </select>
                        </label>
                        <label className="admin-check">
                            <input
                                type="checkbox"
                                checked={form.active}
                                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                            />
                            Active
                        </label>
                    </div>
                    <button type="submit" className="admin-btn" disabled={saving}>
                        {saving ? "Saving…" : editingId ? "Update user" : "Create user"}
                    </button>
                </form>
            </section>

            <section className="admin-card" data-tour="main-table">
                <h2>All users ({users.length})</h2>
                <div className="admin-table-wrap">
                    <table className="admin-table">
                        <thead>
                            <tr>
                                <th>Username</th>
                                <th>Name</th>
                                <th>Email</th>
                                <th>Role</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="admin-empty">No users yet.</td>
                                </tr>
                            ) : (
                                users.map((u) => {
                                    const isSelf = Number(u.id) === Number(me?.id);
                                    return (
                                    <tr key={u.id}>
                                        <td>
                                            {u.username}
                                            {isSelf ? <span className="admin-you"> (you)</span> : null}
                                        </td>
                                        <td>{u.fullName || "—"}</td>
                                        <td>{u.email || "—"}</td>
                                        <td>
                                            <span className={`admin-badge admin-badge--${u.role}`}>{u.role}</span>
                                        </td>
                                        <td>{u.active ? "Active" : "Inactive"}</td>
                                        <td className="admin-actions">
                                            <button type="button" className="admin-link" onClick={() => startEdit(u)}>
                                                Edit
                                            </button>
                                            <button
                                                type="button"
                                                className="admin-link admin-link--danger"
                                                onClick={() => handleDelete(u)}
                                                disabled={isSelf}
                                                title={
                                                    isSelf
                                                        ? "You cannot delete your own account"
                                                        : `Delete ${u.username}`
                                                }
                                            >
                                                Delete
                                            </button>
                                        </td>
                                    </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    );
}
