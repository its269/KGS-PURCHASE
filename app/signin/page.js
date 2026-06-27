"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import "@/styles/signin.css";
import { withBasePath } from "@/lib/base-path";

const LOGIN_API = withBasePath("/api/auth/login");

/* ── SVG Icons ─────────────────────────────────────────── */
const IconUser = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
);

const IconLock = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
);

const IconEye = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
    </svg>
);

const IconEyeOff = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
        <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
);

const IconAlert = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
);

/* ── Component ──────────────────────────────────────────── */
export default function SignInPage() {
    const router = useRouter();
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError("");

        if (!username || !password) {
            setError("Please fill in all fields.");
            return;
        }

        setLoading(true);
        try {
            const res = await fetch(LOGIN_API, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ username, password }),
            });

            const data = await res.json();

            if (!res.ok) {
                setError(data?.message || "Invalid credentials. Please try again.");
                return;
            }

            const { sessionId } = data;
            if (sessionId) {
                localStorage.setItem("acu_session", sessionId);
            }

            // Fetch the user's full name (FirstName + LastName) from Acumatica
            let displayName = username;
            try {
                const meRes = await fetch(withBasePath(`/api/auth/me?username=${encodeURIComponent(username)}`), {
                    headers: { "Authorization": `Bearer ${sessionId}` }
                });
                if (meRes.ok) {
                    const meData = await meRes.json();
                    if (meData?.fullName) displayName = meData.fullName;
                    // Also persist first/last individually for flexible display
                    if (meData?.first) localStorage.setItem("userFirstName", meData.first);
                    if (meData?.last) localStorage.setItem("userLastName", meData.last);
                }
            } catch {
                // Non-fatal — fall back to raw username
            }

            // Store the full display name for the dashboard greeting
            localStorage.setItem("userName", displayName);
            
            // Direct reload to ensure all components pick up the new session
            window.location.href = withBasePath("/dashboard");
        } catch (err) {
            setError("Unable to connect to the server. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="signin-wrapper">
            <div className="signin-card">
                <div className="signin-header">
                    <div className="signin-logo-container">
                        <img
                            src="https://kelin-website.vercel.app/KELIN-LOGO-01.png"
                            alt="Kelin Logo"
                            className="signin-logo-img"
                        />
                    </div>
                    <h1 className="signin-title">KGS PURCHASING</h1>
                    <p className="signin-subtitle">Please enter your account details</p>
                </div>

                <form className="signin-form" onSubmit={handleSubmit} noValidate>
                    {error && (
                        <div className="signin-error" role="alert">
                            <IconAlert />
                            <span>{error}</span>
                        </div>
                    )}

                    <div className="signin-field">
                        <label className="signin-label" htmlFor="username">
                            Username
                        </label>
                        <div className="signin-input-wrapper">
                            <span className="signin-input-icon"><IconUser /></span>
                            <input
                                id="username"
                                className="signin-input"
                                type="text"
                                placeholder="Username"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                autoComplete="username"
                                required
                                suppressHydrationWarning
                            />
                        </div>
                    </div>

                    <div className="signin-field">
                        <label className="signin-label" htmlFor="password">
                            Password
                        </label>
                        <div className="signin-input-wrapper">
                            <span className="signin-input-icon"><IconLock /></span>
                            <input
                                id="password"
                                className="signin-input"
                                type={showPassword ? "text" : "password"}
                                placeholder="Password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                autoComplete="current-password"
                                required
                                suppressHydrationWarning
                            />
                            <button
                                type="button"
                                className="signin-toggle-password"
                                onClick={() => setShowPassword(!showPassword)}
                                aria-label={showPassword ? "Hide password" : "Show password"}
                                suppressHydrationWarning
                            >
                                {showPassword ? <IconEyeOff /> : <IconEye />}
                            </button>
                        </div>
                    </div>

                    <div className="signin-options">
                        <div className="signin-remember">
                            <input
                                id="remember"
                                className="signin-checkbox"
                                type="checkbox"
                            />
                            <label htmlFor="remember" className="signin-remember-label">
                                Remember me
                            </label>
                        </div>
                        <button type="button" className="signin-forgot-btn" onClick={() => alert("Please contact your administrator to reset your password.")}>
                            Forgot password?
                        </button>
                    </div>

                    <button type="submit" className="signin-btn" disabled={loading} suppressHydrationWarning>
                        {loading ? <span className="signin-spinner" /> : "Sign In"}
                    </button>
                </form>

                <div className="signin-footer">
                    <p>&copy; {new Date().getFullYear()} Kelin Graphics System Corp.</p>
                </div>
            </div>
        </div>
    );
}

