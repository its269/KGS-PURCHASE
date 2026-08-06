# Admin Users & Dual Login — Design

**Date:** 2026-08-06  
**Status:** Approved

## Goal
Local app accounts (admin/user) with an Admin page to create and edit users, while keeping Acumatica ERP access via system credentials.

## Auth
1. Login checks `app_users` only (bcrypt). Acumatica usernames/passwords are not accepted for sign-in.
2. On success: store `localUser` on session; optionally attach system Acumatica credentials from env for ERP/sync (or bypass).
3. Create accounts via Admin page.

## Data (`db_purchase.app_users`)
`id`, `username` (unique), `password_hash`, `full_name`, `email`, `role` (`admin`|`user`), `active`, `created_at`, `updated_at`

Seed admin: `admin` / strong default (printed once; change after first login).

## APIs
- `GET/POST /api/admin/users` — admin only
- `PATCH/DELETE /api/admin/users/[id]` — admin only
- `GET/PATCH /api/auth/profile` — self

## UI
- `/admin` — user table + create/edit; own profile section
- Sidebar “Admin” link for `role === admin` only
