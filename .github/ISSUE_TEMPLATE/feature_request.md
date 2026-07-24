---
name: Feature Request
about: Suggest a new feature for the ACU Inventory System
title: '[FEAT] '
labels: enhancement
assignees: ''

---

## Component
- [ ] UI / Dashboard (React)
- [ ] BFF / Streaming API (Next.js)
- [ ] Acumatica Data Model
- [ ] New View/Page

## Problem Statement
A clear and concise description of the problem or need.

## Proposed Solution
How should this feature work?

## Proposed Architecture (Next.js Streaming BFF)
- **API Route:** What new endpoint in `app/api/` is needed? Does it need NDJSON streaming?
- **Service Layer:** What changes are needed in `services/acumatica.js`?
- **UI Components:** What new components or page changes are required in `app/` or `components/`?

## Data Transformation
- [ ] This feature requires mapping raw Acumatica JSON to a flattened Application Model.
- **Mapping Details:** (List key fields to be extracted from Acumatica)

## Screenshots (if applicable)
Add any mockups or screenshots that help explain the feature.

## Additional Context
Add any other context about the feature request here.
