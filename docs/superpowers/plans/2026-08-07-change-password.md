# Change Password (Account Page) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any logged-in local user change their password on `/account` after verifying their current password.

**Architecture:** Harden `PATCH /api/auth/profile` to require `currentPassword` when setting a new password. Add `/account` UI (reuse Admin form CSS) and a Sidebar link above Logout. Remove self password field from Admin My account so password changes go through one path.

**Tech Stack:** Next.js App Router, bcryptjs via `lib/app-users.js`, vanilla CSS (`styles/admin.css`), `fetchWithAuth`.

**Spec:** `docs/superpowers/specs/2026-08-07-change-password-design.md`

## Global Constraints

- Password min 8 / max 128 (`validatePassword`)
- Self-service password change requires current password verification
- Admin reset of other users via `/api/admin/users/[id]` unchanged
- No forgot-password flow; no forced multi-session logout
- Do not commit unless the user asks
- Vanilla CSS only (no utility frameworks)

## File map

| File | Responsibility |
|------|----------------|
| `app/api/auth/profile/route.js` | Verify current password before hash update |
| `app/account/layout.js` | Sidebar shell |
| `app/account/page.js` | Change-password form |
| `components/Sidebar.js` | Account link above Logout |
| `app/admin/page.js` | Remove My account password field; link to `/account` |

---

### Task 1: Harden profile PATCH API

**Files:**
- Modify: `app/api/auth/profile/route.js`

**Interfaces:**
- Consumes: `requireLocalUser`, `verifyPassword`, `hashPassword`, `validatePassword`, `MySqlService.getAppUserById` / `updateAppUser`
- Produces: `PATCH` body `{ currentPassword?, password?, confirmPassword?, username?, fullName?, email? }` — when `password` non-empty, requires matching `currentPassword` and matching `confirmPassword`

- [ ] **Step 1: Update PATCH password branch**

Replace the password block so that when `body.password` is non-empty:

1. If `!body.currentPassword` → 400 `"Current password is required."`
2. Load row via `getAppUserById(me.id)`; if missing → 401
3. If `!verifyPassword(body.currentPassword, row.password_hash)` → 401 `"Current password is incorrect."`
4. `validatePassword(body.password)` → 400 on failure
5. If `body.confirmPassword !== body.password` → 400 `"New passwords do not match."`
6. `fields.passwordHash = hashPassword(body.password)`

Import `verifyPassword` from `@/lib/app-users`.

- [ ] **Step 2: Manual verify**

Wrong current password returns 401; matching passwords update hash. (Dev-server check when Account UI exists.)

---

### Task 2: Account page UI

**Files:**
- Create: `app/account/layout.js`
- Create: `app/account/page.js`
- Reuse: `styles/admin.css` (import in page)

**Interfaces:**
- Consumes: `PATCH /api/auth/profile` with `{ currentPassword, password, confirmPassword }`
- Produces: `/account` route for all authenticated roles

- [ ] **Step 1: Create layout** — same pattern as `app/admin/layout.js` (Sidebar + main-content).

- [ ] **Step 2: Create page** with:
  - Title “Account” / subtitle about changing password
  - Form: current password, new password, confirm
  - Client validation: all required; new === confirm; min 8
  - Submit via `fetchWithAuth("/api/auth/profile", { method: "PATCH", body: JSON.stringify(...) })`
  - Success/error alerts using `admin-alert` classes; clear fields on success
  - Import `@/styles/admin.css` and `fetchWithAuth` from existing lib

- [ ] **Step 3: Smoke-check** — open `/account` while logged in; form renders.

---

### Task 3: Sidebar Account link

**Files:**
- Modify: `components/Sidebar.js`

**Interfaces:**
- Produces: footer link to `/account` above Logout, active when pathname is `/account`

- [ ] **Step 1: Add Account control in `sidebar-footer`** above Logout (Link or `<a>` matching nav styling), using a simple user/key icon SVG, `withBasePath("/account")`, title when collapsed.

- [ ] **Step 2: Confirm** link visible for admin and non-admin; highlights on `/account`.

---

### Task 4: Admin My account cleanup

**Files:**
- Modify: `app/admin/page.js`

**Interfaces:**
- Removes password from profile save payload; points users to `/account`

- [ ] **Step 1: Remove** the “New password” field from My account form; remove `password` from `profile` state and `handleSaveProfile` payload.

- [ ] **Step 2: Add** short note under My account heading: “To change your password, use Account in the sidebar.” (link to `/account`).

- [ ] **Step 3: Manual acceptance**
  - [ ] Non-admin: change password on `/account`, re-login with new password
  - [ ] Wrong current password shows error
  - [ ] Confirm mismatch blocked
  - [ ] Admin reset of another user still works without their current password

---

## Spec coverage check

| Spec requirement | Task |
|------------------|------|
| `/account` page + form | Task 2 |
| Sidebar Account link | Task 3 |
| currentPassword verification | Task 1 |
| confirm match client+server | Tasks 1–2 |
| Admin other-user reset unchanged | Task 1 (no admin route edits) |
| Remove Admin self password field | Task 4 |
