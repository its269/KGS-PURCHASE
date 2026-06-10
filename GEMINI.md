# ACU Project (HRIS)

A Next.js-based Human Resource Information System (HRIS) application focused on viewing and managing data from Acumatica.

## Project Overview

- **Framework:** Next.js 16.2.6 (App Router)
- **Library:** React 19.2.4
- **Architecture:** Modern MVC / BFF (Backend-for-Frontend)
- **Styling:** Vanilla CSS (Strictly avoid utility frameworks unless requested)
- **Data Source:** Acumatica ERP via REST API

## Architecture: Streaming BFF

To ensure performance with large Acumatica datasets, the project follows a streaming BFF (Backend-for-Frontend) pattern:

1.  **API Layer (`app/api/`):**
    *   Acts as the primary data orchestrator.
    *   Handles authentication and session persistence with Acumatica.
    *   Transforms raw Acumatica JSON into flattened, application-specific models.
    *   Uses NDJSON streaming for high-volume endpoints (e.g., inventory).
2.  **View Layer (`app/` pages & layouts):**
    *   Uses Next.js App Router.
    *   Consumes streaming APIs using `ReadableStream` and chunked processing in the browser.
    *   Focuses on low-latency rendering and minimalist styling.
3.  **Styles (`styles/`):**
    *   Vanilla CSS modules and globals.
    *   No utility frameworks.

## Building and Running

- **Development:** `npm run dev`
- **Build:** `npm run build`
- **Production Start:** `npm run start`
- **Linting:** `npm run lint`

## Development Conventions

- **Path Aliases:** Always use `@/*` for root-relative imports.
- **Styling:** Follow the minimalist CSS pattern in `styles/`. Prefer modularity.
- **Data Fetching:** Prefer Server Components for data fetching to keep Acumatica credentials secure.
- **Transformation:** Always transform Acumatica's raw JSON response into clean Application Models in the Service layer before it reaches the UI.

## Important Note for AI Agents

Refer to `node_modules/next/dist/docs/` for version-specific documentation of Next.js 16.2.6. Pay close attention to `AGENTS.md` for breaking changes in this custom version.
