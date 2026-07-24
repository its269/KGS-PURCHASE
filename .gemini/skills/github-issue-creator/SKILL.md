# Skill: GitHub Issue Creator

Automate the creation of high-quality GitHub issues using the project's templates.

## Instructions
When asked to create an issue, follow these steps:
1. **Analyze the Task:** Determine if it's a `BUG`, `FEAT`, `CHORE`, `DOCS`, or `IMPROVE`.
2. **Select Template:** Use the corresponding template from `.github/ISSUE_TEMPLATE/`.
3. **Gather Context:**
   - For Bugs: Check logs and reproduction steps.
   - For Features: Map out the Streaming BFF architecture (API route, Service change, UI).
4. **Draft Content:** Fill in all placeholders in the template with specific details from the current context.
5. **Execution:** Use the `github` MCP tool to create the issue in the repository.

## Capabilities
- Detects the appropriate issue type automatically.
- Maps Acumatica data requirements to the "Proposed Architecture" section.
- Ensures all issues are tagged with the correct labels (`bug`, `enhancement`, `chore`, etc.).
