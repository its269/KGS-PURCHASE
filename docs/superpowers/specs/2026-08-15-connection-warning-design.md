# Connection warning modal

## Goal
Show a centered popup when the app cannot save data because of connectivity problems, with distinct copy for internet vs server/database outages.

## Behavior
- Monitor `navigator.onLine` / `online` / `offline` events.
- Periodically call public `GET /api/health` (pings MySQL with a short timeout).
- Surface failures from `fetchWithAuth` (network errors, HTTP 503).
- Modal messages:
  - **Internet:** no internet; changes will not be saved; check connection or contact admin.
  - **Server:** cannot reach server/database; changes will not be saved; try later or contact admin.
- Actions: **Try again** (re-probe), **Dismiss** (hides until the next failure / next down probe).
- Auto-hides when health recovers.

## Files
- `app/api/health/route.js`
- `components/ConnectionWarning.js`
- `styles/connection-warning.css`
- `lib/connection-status.js`
- `lib/api-client.js` (reports failures)
- `proxy.js` (public `/api/health`)
- `services/mysql.js` (`pingDatabases`)
