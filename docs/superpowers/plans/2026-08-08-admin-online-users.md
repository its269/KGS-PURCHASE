# Admin Online Users Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins see which local users are online (active in the last 3 minutes) on the Admin page.

**Architecture:** Query existing `app_sessions.last_seen_at` (already touched by `/api/auth/session` ~60s). Add `listOnlineUsers` + `GET /api/admin/online`, show an “Online now” card on Admin with 30s polling.

**Tech Stack:** Next.js App Router, MySQL (`purchasePool`), vanilla CSS (`admin.css`), `requireAdmin`.

**Spec:** `docs/superpowers/specs/2026-08-08-admin-online-users-design.md`

## Global Constraints

- Online = `last_seen_at` within 3 minutes (default; clamp window 1–15).
- One row per user; no `session_id` in API response.
- Admin-only; no WebSockets / new heartbeat table.
- Vanilla CSS only.

---

### Task 1: MySQL `listOnlineUsers`

**Files:** `services/mysql.js`

- [ ] Add `listOnlineUsers({ withinMinutes = 3 })` after session helpers (`touchAppSession` area).
- [ ] Ensure `ensureAppSessionsTable` / `ensureAppUsersTable` called.
- [ ] Join active users to sessions; newest `last_seen_at` per `user_id`; order DESC.

### Task 2: Admin API route

**Files:** `app/api/admin/online/route.js` (create)

- [ ] `GET` with `requireAdmin`.
- [ ] Parse `windowMinutes` (default 3, clamp 1–15).
- [ ] Return `{ windowMinutes, count, users }` mapped to camelCase (no session ids).

### Task 3: Admin UI + CSS

**Files:** `app/admin/page.js`, `styles/admin.css`

- [ ] State + `loadOnline` / 30s interval while mounted.
- [ ] “Online now” card after header alerts, before “My account”.
- [ ] Green dot, username, full name, role badge, company, relative last seen.
- [ ] Empty: “No users online right now.”
- [ ] Styles for online list / count badge.

### Task 4: Smoke check

- [ ] Admin loads without error; `/api/admin/online` returns JSON for admin session.
- [ ] Non-admin gets 403.
