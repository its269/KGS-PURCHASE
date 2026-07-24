# Skill: Copilot Designer

Expert guidance for UI/UX and Architecture design within the ACU Inventory project.

## Instructions
1. **Architecture First:** Always prioritize the **Streaming BFF** pattern. Ensure data flows from Acumatica -> Service -> API Route (Streaming) -> UI.
2. **Styling Rules:** Strictly enforce **Vanilla CSS**. Deny any requests for Tailwind, Bootstrap, or other utility frameworks.
3. **Component Design:**
   - Keep components functional and stateless where possible.
   - Use CSS Modules for scoping.
   - Ensure accessibility and responsiveness.
4. **Acumatica Integration:**
   - Design data models that are "UI-ready" (flattened).
   - Handle loading states for streaming data (e.g., skeletons, progressive rendering).

## Usage
Use this skill when designing new views, refactoring existing UI, or planning new Acumatica integrations.
