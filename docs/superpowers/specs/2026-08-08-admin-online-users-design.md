# Admin Online Users — Design

**Date:** 2026-08-08  
**Status:** Approved (Approach 1)  
**Repo:** KGS-PURCHASE

## Goal

Admins can see which local app users are **currently online** (actively using the system), using existing session heartbeats — no new realtime stack.

## Definition of “online”

A user is **online** when they have at least one `app_sessions` row with:

`last_seen_at >= NOW() - INTERVAL 3 MINUTE`

Rationale: clients already call `/api/auth/session` about every 60s while the tab is open (`SessionStatus` + Sidebar). A 3-minute window covers 1–2 missed pings without treating stale logins as online.

**Not in scope for v1:** signed-in-but-idle list, force-logout, IP/device fingerprint, historical activity log, WebSockets.

## Data source (existing)

| Piece | Location |
|-------|----------|
| Sessions table | `app_sessions` (`session_id`, `user_id`, `active_company_id`, `last_seen_at`) |
| Users | `app_users` |
| Heartbeat | `MySqlService.touchAppSession` on successful `/api/auth/session` |
| Client poll | ~60s via `SessionStatus` / `checkSessionStatus` |

No new heartbeat endpoint required.

## Backend

### `MySqlService.listOnlineUsers({ withinMinutes = 3 })`

- `INNER JOIN app_sessions s ON s.user_id = u.id`
- Filter `u.active = 1` and `s.last_seen_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)`
- **One row per user** (newest `last_seen_at` wins) via `GROUP BY u.id` / subquery
- Order by `last_seen_at DESC`
- Return: `id`, `username`, `full_name`, `role`, `active_company_id`, `last_seen_at`

### `GET /api/admin/online`

- Guard: `requireAdmin` (same as `/api/admin/users`)
- Optional query: `?windowMinutes=3` (clamp 1–15, default 3)
- Response:

```json
{
  "windowMinutes": 3,
  "count": 2,
  "users": [
    {
      "id": 1,
      "username": "admin",
      "fullName": "Admin",
      "role": "admin",
      "activeCompanyId": "main",
      "lastSeenAt": "2026-08-08T02:50:00.000Z"
    }
  ]
}
```

- 401 if unauthenticated; 403 if not admin

Do **not** expose raw `session_id` in the API response.

## Frontend (Admin page)

Add an **“Online now”** card near the top of `app/admin/page.js` (above or beside user management), styled with existing `admin-card` / `admin.css` patterns.

| Element | Behavior |
|---------|----------|
| Header | “Online now” + live count badge |
| List/table | Username, full name, role badge, company, relative “Last seen” |
| Empty | “No users online right now.” |
| Refresh | Poll `GET /api/admin/online` every **30s** while Admin page is mounted; also refresh on initial load |
| Indicator | Green status dot (reuse session-status visual language if available) |

Admin-only page already redirects non-admins; no extra nav item.

## Security

- Admin role required for the online list
- No session tokens or cookies in the payload
- Presence is soft (last seen), not a security boundary

## Acceptance criteria

1. With two browsers signed in as different users and Admin open, both appear under Online now within ~3 minutes of activity.
2. Closing a tab (no further heartbeats) removes the user from the list after the 3-minute window.
3. Non-admin cannot call `/api/admin/online` successfully.
4. No WebSocket / Redis / new heartbeat table introduced.
