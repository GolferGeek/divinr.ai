# Effort: Contract Editor UI

## Problem

Analyst contracts (`context_markdown` on `analyst_config_versions`) are the core artifact that drives predictions, audits, and learning — but there's no UI for viewing or editing them. Admins must read contracts from the database and edit via raw SQL or scripts. Version history exists (the `parent_version_id` chain) but is invisible. Rollback is API-only. When the Tier 2 audit surfaces a discrepancy, there's no way to inspect or fix the contract from the same admin workflow.

## Intention

Build an admin-facing contract editor that lets the user read, edit, diff, and roll back analyst contracts — all from the browser, living alongside the existing Tier 2 findings inbox.

## Scope

- **Read**: View the active contract for any analyst, rendered as styled markdown with section headings (General, Role sections, Adaptations).
- **Version history**: List all config versions for an analyst with source attribution (manual, tier1_auto, tier2_approved), timestamps, and change reasons.
- **Diff**: Side-by-side comparison of any two versions showing what changed.
- **Edit**: Modify the active contract's markdown. Saving creates a new config version (source: `manual`) with `parent_version_id` linking to the previous version.
- **Rollback**: One-click rollback to the previous version, wired to the existing `POST /markets/analysts/:analystId/rollback` endpoint.
- **Navigation**: Accessible from the analyst list (`/analysts`) and the findings inbox (`/findings`). When reviewing an audit finding, the user should be able to jump to the relevant contract.

## Success Criteria

- An admin can view, edit, and save an analyst's contract from the browser.
- Version history is visible with source attribution and timestamps.
- Side-by-side diff between any two versions is readable.
- Rollback works in one click and reflects immediately in the UI.
- The editor is reachable from both the analyst list and the audit findings inbox.
- Write operations are gated behind the existing `canWrite` guard (beta readers cannot edit).

## Out of Scope

- Editing `persona_prompt` or `tier_instructions` directly (those are legacy fields; `context_markdown` is the contract of record).
- AI-assisted contract generation or suggestions.
- Tier 3 strategic overhauls (future effort).
- Real-time collaborative editing.
- Changing the contract section structure or parser.
