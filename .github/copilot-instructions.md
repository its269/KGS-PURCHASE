# Copilot Instructions for ACU Inventory

You are an expert developer working on the **ACU Inventory System**, a Next.js (App Router) application that integrates with Acumatica ERP.

## Technical Stack
- **Framework:** Next.js 16.2.6
- **Architecture:** Streaming BFF (Backend-for-Frontend)
- **Styling:** Vanilla CSS (Strictly NO Tailwind or utility frameworks)
- **Data:** Acumatica REST API

## Core Principles
1. **Streaming First:** Always prefer streaming data from API routes to the UI using NDJSON or Chunked transfers for large Acumatica datasets.
2. **Minimalist UI:** Keep components lean and focused. Use Vanilla CSS modules.
3. **Security:** Never expose Acumatica tokens or credentials to the client. Keep transformation logic in `services/` and `app/api/`.
4. **Acumatica Mapping:** Always flatten complex Acumatica JSON responses into clean, application-ready models before sending them to the UI.

## File Structure
- `app/api/`: BFF endpoints.
- `services/`: Business logic and Acumatica integration.
- `styles/`: Global and modular CSS.
- `components/`: Shared UI components.
