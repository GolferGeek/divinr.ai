# Intention: Tier 1 Structured Writes

## What
Update the Tier 1 learning engine to write adjustments into the `## Adaptations` section of analyst contracts instead of appending hardcoded text suffixes to `persona_prompt`.

## Why
The learning engine currently mutates `persona_prompt` directly with freeform text appended at the end. This is fragile — it doesn't follow the structured contract format established in `analyst-contracts`, and the carry-forward logic has to work around it. Structured writes into `## Adaptations` would:

1. Keep analyst contracts in a consistent, parseable markdown format
2. Make learning-engine changes visible and auditable in the same format humans read
3. Align Tier 1 autonomous adjustments with the contract structure that Tier 2 audits against
4. Simplify the carry-forward logic that copies contracts between config versions

## Context
- The `analyst-contracts` effort established structured markdown contracts with sections: `## Persona`, `## Adaptations`, `## General Instructions`
- The `parse-contract-markdown.ts` utility already reads these sections
- The carry-forward (`context-markdown-carry-forward`) copies the full contract to new versions
- The learning engine (`learning-engine.service.ts`) currently appends text to `persona_prompt` after nightly evaluation
- Tier 2 audit checks outputs against contracts — if learning writes are outside the contract structure, they're invisible to audit

## Success criteria
- Learning engine writes into `## Adaptations` section of `context_markdown` instead of appending to `persona_prompt`
- Existing contract parsing still works (parse-contract-markdown reads the updated adaptations)
- Carry-forward preserves adaptations across config versions
- Nightly evaluation → learning cycle produces well-formed adaptation entries
- Tier 2 audit can see learning-engine changes in the contract structure
- All existing tests pass, new tests cover the structured write path
