# Tour Guide Tutorial — Design

**Date:** 2026-08-08  
**Status:** Implemented (per-module)

## Goal
Game-style floating coach marks per module. Auto-play **once** on first visit; replay anytime.

## Behavior
- Every module has its own tour and its own done flag in the browser (localStorage).
- First open of a module starts the tour automatically (all users, including admin).
- Skip / Finish means that module will not auto-show again.
- Replay via floating Tour Guide on that page, or Account → Tour Guides → Replay.
- Leaving a module mid-tour counts as done for that module.

## Modules
Inventory, Stock Items, Purchase Orders, Incoming PO, Suppliers, Replenishment, Sales, Syncing Center, Admin, Account.
