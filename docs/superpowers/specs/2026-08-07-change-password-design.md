# Change Password (Account Page) — Design

**Date:** 2026-08-07  
**Status:** Approved — implemented  
**Scope:** Let any logged-in local user change their own password

## Problem

Local app users authenticate with bcrypt passwords in `app_users`. Admins can set a new password on **Admin → My account** via `PATCH /api/auth/profile`, but:

1. Non-admin users cannot open `/admin`, so they have no UI to change their password.
2. The profile API currently accepts a new password **without** verifying the current one.

## Goals

- Every authenticated local user can change their own password.
- Changing password requires proving the current password.
- UI matches existing Admin card/form patterns (vanilla CSS).
- Admin reset of *other* users’ passwords stays as-is (no current-password required).

## Non-goals

- Forgot-password / email reset flow
- Forcing logout of other sessions after a password change
- Changing username / profile fields on this page (password only for v1)

## Approach (recommended)

Dedicated **`/account`** page + sidebar **Account** link above Logout, hardening `PATCH /api/auth/profile` for password changes.

### Alternatives considered

| Option | Pros | Cons |
|--------|------|------|
| Account page (chosen) | Visible to all roles; clear dedicated UX; reuses admin form CSS | Extra route |
| Sidebar modal | Fast | No existing account-modal pattern; cramped on mobile |
| Admin-only | Already partly built | Non-admins cannot change password |

## UI

### Route

- `app/account/page.js` — client page with change-password form
- `app/account/layout.js` — standard app shell (Sidebar + main), same pattern as other modules

### Sidebar

- Add `{ name: "Account", href: "/account", ... }` for **all** roles, placed near the footer / above Logout (or at end of nav before Admin — prefer **above Logout** in the footer cluster so it reads as “my settings”).
- Active state when `pathname` starts with `/account`.

### Form fields

1. Current password (required)
2. New password (required, min 8 / max 128 — existing `validatePassword`)
3. Confirm new password (required; must match new)

### Behavior

- Submit via `fetchWithAuth` → `PATCH /api/auth/profile` with `{ currentPassword, password, confirmPassword }`.
- On success: show notice, clear all three fields.
- On error: show server/client message; do not clear current password unless desired (clear all is fine for simplicity).
- Client-side: reject empty fields and mismatched confirm before calling API.

### Styling

- Reuse `styles/admin.css` classes (`.admin-card`, `.admin-form`, `.admin-form-grid`, `.admin-btn`, alerts) **or** a thin `styles/account.css` that imports/mirrors the same tokens — prefer reusing admin classes to avoid drift.
- No new design system; match dark theme already used by Admin.

## API

### Harden `PATCH /api/auth/profile`

When `body.password` is present and non-empty:

1. Require `body.currentPassword` (non-empty).
2. Load the user’s row including `password_hash` from MySQL (`getAppUserById`).
3. `verifyPassword(currentPassword, password_hash)` — if false → **401** with message like `"Current password is incorrect."`
4. `validatePassword(body.password)` — if fail → **400**.
5. If `body.confirmPassword` is provided, require equality with `body.password` — else **400** `"New passwords do not match."` (client always sends it; server enforces).
6. Set `fields.passwordHash = hashPassword(body.password)`.

Profile updates that do **not** include a new password keep current behavior (username / fullName / email without current password).

### Admin routes unchanged

- `PATCH /api/admin/users/[id]` may still set `password` without current password (admin privilege).
- Admin page “My account” should either:
  - **A (recommended):** also send `currentPassword` when setting a new password (align with hardened API), **or**
  - Keep calling profile without current password and break — **not acceptable**.

So Admin “My account” password field must gain a **Current password** field when changing password, OR redirect admins to `/account` for password changes and remove password from Admin My account.

**Recommended:** Keep Admin My account for username/name/email; move password change exclusively to `/account` (remove optional new-password from Admin My account to one place). Simpler UX, one code path.

## Security notes

- Never return password hashes to the client (`sanitizeUser` already strips them).
- Use existing bcrypt (10 rounds) helpers in `lib/app-users.js`.
- Do not log plaintext passwords.
- Rate limiting: out of scope for v1; rely on session auth.

## Files to touch

| File | Change |
|------|--------|
| `app/account/page.js` | New change-password UI |
| `app/account/layout.js` | Shell with Sidebar |
| `components/Sidebar.js` | Account link |
| `app/api/auth/profile/route.js` | Require + verify `currentPassword` on password change; optional confirm |
| `app/admin/page.js` | Remove self password field from My account (point users to Account) **or** add current password — prefer remove + link |
| `styles/admin.css` or `styles/account.css` | Reuse / minor layout if needed |

## Acceptance criteria

1. Non-admin user can open `/account` from the sidebar and change password with correct current password.
2. Wrong current password → clear error; password unchanged.
3. Mismatched confirm → rejected client and server.
4. After success, login with the new password works; old password fails.
5. Admin reset of another user still works without that user’s current password.
6. Unauthenticated requests to `/account` / profile API remain blocked by existing session middleware.

## Test plan (manual)

- [ ] As `user` role: change password on `/account`, sign out, sign in with new password
- [ ] Wrong current password shows error
- [ ] Confirm mismatch blocked
- [ ] As admin: reset another user’s password on `/admin` still works
- [ ] Sidebar Account link visible for both roles; active on `/account`
