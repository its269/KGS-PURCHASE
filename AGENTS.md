# ACU Inventory Project Guide

**GitHub Repository:** [acu-inventory](https://github.com/your-username/acu-inventory)

This is the central guide for the **ACU Inventory** project. The application is built using Next.js (App Router) and integrates directly with Acumatica ERP.

## Repository Structure

- **`app/`**: Next.js App Router (Views and API Routes).
- **`components/`**: Shared React components.
- **`services/`**: Core logic for Acumatica integration.
- **`styles/`**: Vanilla CSS modules and globals.
- **`.github/`**: Issue and PR templates for automation.
- **`.gemini/`**: Custom skills, agents, and commands for the Gemini CLI.

## Architecture: Streaming BFF

The project follows a **Streaming Backend-for-Frontend (BFF)** pattern:
1.  **Acumatica Layer:** Source of truth (REST API).
2.  **Service Layer (`services/acumatica.js`):** Handles auth, session, and raw data fetching. Transforms raw JSON into flattened models.
3.  **API Layer (`app/api/`):** Orchestrates data flow. Uses NDJSON/Chunked streaming for large datasets (e.g., Inventory).
4.  **UI Layer (`app/` & `components/`):** Consumes streams and renders data progressively. Uses Vanilla CSS.

## Instructions for Gemini CLI

- **Issue Management:** Always use the `/gen-issues` command or the `github-issue-creator` skill to create issues. This ensures the correct templates are used.
- **Implementation:** Use `/implement-issue` to start working on a task. It will automatically create a plan in `plans/` following the Streaming BFF pattern.
- **Security:** Every change must be audited by the `security-auditor` agent to prevent Acumatica credential leaks.
- **Styling:** Strictly follow the Vanilla CSS modularity. No utility frameworks allowed.

## Development Workflow

1.  **Issue Creation:** Use templates in `.github/ISSUE_TEMPLATE/`.
2.  **Pull Requests:** Use the template in `.github/PULL_REQUEST_TEMPLATE.md`.
3.  **Automation:** Use slash commands (`/mcp reload`, `/delegate-issue`, etc.) to speed up your workflow.

---
*ACU Inventory — Efficient Inventory Management via Acumatica.*
<!-- Automation Trigger: Gemini Reviewer enabled -->
