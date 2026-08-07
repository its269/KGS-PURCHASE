# Inventory Damage, Location, Filters & PO Status — Design

**Date:** 2026-08-07  
**Status:** Approved

## Inventory
1. **Damage KPI** — Sync DAMAGE warehouse rows into MySQL (not mixed into MAIN totals). Card shows units + product count; click → filtered modal.
2. **Location** — On row expand, show Location ID + qty (live Acumatica Inventory Summary when possible; cache in MySQL when synced).
3. **Toolbar filters** — Compact branch/search/refresh layout.

## Purchase Orders
4. **Column filters** — Quieter funnel + popover styling.
5. **ERP Status** — Dropdown of Acumatica statuses; PATCH updates `purchase_history.status` locally. User Status unchanged.

## Non-goals
- Full Acumatica light theme
- ERP Hold/Release action write-back (phase 2)
- Incoming PO page redesign
