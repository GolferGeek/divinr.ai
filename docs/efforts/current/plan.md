# Contract Editor UI — Implementation Plan

**PRD**: prd.md
**Created**: 2026-04-09
**Status**: Complete

## Progress Tracker

- [x] Phase 1: API endpoints — contract read + write
- [x] Phase 2: Contract viewer page + navigation links
- [x] Phase 3: Edit, save, diff, and rollback

---

## Phase 1: API endpoints — contract read + write
**Status**: Complete
**Objective**: Add `GET /analysts/:analystId/contract` and `PUT /analysts/:analystId/contract` endpoints returning the active contract with parsed sections and full version history.

### Steps
- [ ] 1.1 In `apps/api/src/markets/markets.service.ts`, add a `getAnalystContract(analystId, organizationSlug)` method that:
  - Fetches the analyst row (display_name, current_config_version_id) from `market_analysts`
  - Fetches all `analyst_config_versions` rows for the analyst ordered by `version_number DESC`, returning: id, version_number, source, change_reason, created_by, created_at, is_active, context_markdown
  - Parses the active version's `context_markdown` via `parseContractMarkdown()`
  - Returns the shape specified in PRD §4.3 (analystId, displayName, activeVersionId, contract, versions)
- [ ] 1.2 In `apps/api/src/markets/markets.service.ts`, add a `saveAnalystContract(input: { analystId, organizationSlug, userId, markdown, changeReason? })` method that:
  - Loads the current active config version id from `market_analysts`
  - Deactivates the current version (`is_active = false`)
  - Inserts a new `analyst_config_versions` row with source `'manual'`, `parent_version_id` = old active, `context_markdown` = new markdown, persona_prompt/tier_instructions/default_weight carried from old version
  - Updates `market_analysts.current_config_version_id` to the new version
  - Returns the same shape as `getAnalystContract()` by calling it
- [ ] 1.3 In `apps/api/src/markets/markets.controller.ts`, add `@Get('analysts/:analystId/contract')` endpoint wired to `getAnalystContract`, using `resolveIdentity` for org slug.
- [ ] 1.4 In `apps/api/src/markets/markets.controller.ts`, add `@Put('analysts/:analystId/contract')` endpoint wired to `saveAnalystContract`, gated behind `requireWriteAccess`.
- [ ] 1.5 Write a unit test `apps/api/tests/unit/contract-editor.test.ts` that:
  - Tests `getAnalystContract` returns the active contract with parsed sections and version list
  - Tests `saveAnalystContract` creates a new version, deactivates old, and returns updated data
  - Uses MockDb pattern established in `leaderboard-service.test.ts`

### Quality Gate

- [ ] **Build**: `cd apps/api && pnpm build` — no errors
- [ ] **Lint**: `cd apps/api && pnpm lint` — no errors
- [ ] **Unit Tests**: `cd apps/api && tsx tests/unit/contract-editor.test.ts` — all pass
- [ ] **Existing Tests**: `cd apps/api && tsx tests/unit/leaderboard-service.test.ts` — still pass (no regressions)
- [ ] **Curl Tests** (API on port 7100):
  ```
  # GET contract + versions for an analyst
  curl -s http://localhost:7100/analysts/<analystId>/contract -H "Authorization: Bearer <token>" | jq '.analystId, .displayName, (.versions | length), (.contract.sections | keys)'
  # → analystId, display name, version count > 0, ["adaptations","general","roles"]

  # PUT save edited contract (write user)
  curl -s -X PUT http://localhost:7100/analysts/<analystId>/contract \
    -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
    -d '{"markdown":"## General\nTest edit","changeReason":"test"}' | jq '.activeVersionId'
  # → new version id (different from before)
  ```
- [ ] **Phase Review**:
  - [ ] GET returns active contract with parsed sections (general, roles, adaptations)
  - [ ] GET returns full version history with source, changeReason, createdAt, contextMarkdown
  - [ ] PUT creates a new version with source=manual and parent_version_id linked
  - [ ] PUT deactivates old version and updates market_analysts.current_config_version_id
  - [ ] PUT is write-gated; GET is read-accessible

---

## Phase 2: Contract viewer page + navigation links
**Status**: Complete
**Objective**: Build the read-only `ContractEditorView.vue` with rendered contract display and version history, add the route, and wire navigation from `/analysts` and `/findings`.

### Steps
- [ ] 2.1 Add the route `{ path: 'analysts/:id/contract', name: 'analyst-contract', component: () => import('../views/ContractEditorView.vue') }` to `apps/web/src/router/index.ts`.
- [ ] 2.2 Create `apps/web/src/views/ContractEditorView.vue` with:
  - `onMounted`: fetch `GET /analysts/:id/contract` via `useApi()`
  - Header: analyst display name + `<router-link>` back to `/analysts`
  - Contract viewer: render `context_markdown` with `## ` headings styled as `<h2>` and body as `<pre style="white-space:pre-wrap">` blocks. Parse using a simple split on `## ` (matching the contract structure).
  - Version history panel: collapsible section listing all versions. Each row shows: version number, source chip (color-coded: manual=primary, tier1_auto=tertiary, tier2_approved=success), change reason, timestamp, created_by. Clicking a version replaces the viewer content with that version's `contextMarkdown` (read-only preview mode) with a "Back to active" button.
- [ ] 2.3 In `apps/web/src/views/AnalystsView.vue`, add a `<router-link>` "Contract" button on each analyst card linking to `{ name: 'analyst-contract', params: { id: a['id'] } }`. Use `<ion-button>` with `fill="outline"` and `size="small"`.
- [ ] 2.4 In `apps/web/src/views/AuditFindingsView.vue`, make the analyst name (`f.analystName`) a `<router-link :to="{ name: 'analyst-contract', params: { id: f.analystId } }">` with `@click.stop` to avoid card interaction. Style as underlined primary-colored link.

### Quality Gate

- [ ] **Build**: `cd apps/web && pnpm build` — no errors
- [ ] **Typecheck**: `cd apps/web && pnpm typecheck` — no new errors (pre-existing only)
- [ ] **Lint**: `cd apps/web && pnpm lint` — no errors
- [ ] **Chrome Tests** (dev server on port 7101):
  - [ ] Navigate to `/analysts` — each analyst card shows a "Contract" button
  - [ ] Click "Contract" → navigates to `/analysts/:id/contract`
  - [ ] Contract page shows analyst name, rendered contract with section headings
  - [ ] Version history panel lists versions with source chips, timestamps, change reasons
  - [ ] Click a version in the list → viewer shows that version's markdown with "Back to active" button
  - [ ] Navigate to `/findings` — analyst name on each finding card is a clickable link
  - [ ] Click analyst name on finding → navigates to `/analysts/:id/contract`
- [ ] **Phase Review**:
  - [ ] PRD §2 "View active contract" — rendered contract display works
  - [ ] PRD §2 "Version history" — all versions listed with source, timestamp, change reason
  - [ ] PRD §2 "Navigation from analyst list" — Contract button on each card
  - [ ] PRD §2 "Navigation from findings" — analyst name links to contract

---

## Phase 3: Edit, save, diff, and rollback
**Status**: Complete
**Objective**: Add edit mode with save, client-side version diff, and rollback — all gated behind `canWrite`.

### Steps
- [ ] 3.1 In `ContractEditorView.vue`, add edit mode (canWrite only):
  - "Edit" button toggles a `<textarea>` pre-filled with the active `context_markdown`
  - "Save" button prompts for an optional change reason (simple `<ion-input>` inline), then calls `PUT /analysts/:id/contract` with `{ markdown, changeReason }`
  - On success, refetch contract data to refresh viewer and version history
  - "Cancel" button exits edit mode without saving
- [ ] 3.2 In `ContractEditorView.vue`, add diff mode:
  - Two `<select>` dropdowns to pick versions (by version number)
  - When both are selected, compute a line-by-line diff: split both markdown strings on `\n`, mark lines as added (green background), removed (red background), or unchanged
  - Render side-by-side in a two-column layout with line numbers
  - "Exit Diff" button returns to normal viewer
- [ ] 3.3 In `ContractEditorView.vue`, add rollback button (canWrite only):
  - "Rollback" `<ion-button>` with `color="warning"` and `fill="outline"`
  - On click, calls `POST /analysts/:id/rollback` via `useApi().post()`
  - On success, refetch contract data
  - Handle error gracefully (show ion-note with error message if no parent version)
- [ ] 3.4 Import and use `useCanWrite` composable to conditionally render Edit, Save, and Rollback controls. Verify beta readers see read-only view.

### Quality Gate

- [ ] **Build**: `cd apps/web && pnpm build` — no errors
- [ ] **Typecheck**: `cd apps/web && pnpm typecheck` — no new errors
- [ ] **Lint**: `cd apps/web && pnpm lint` — no errors
- [ ] **API Build**: `cd apps/api && pnpm build` — no errors (in case Phase 1 code was touched)
- [ ] **API Unit Tests**: `cd apps/api && tsx tests/unit/contract-editor.test.ts` — still pass
- [ ] **Chrome Tests** (dev server on port 7101, logged in as admin):
  - [ ] On contract page, "Edit" button is visible
  - [ ] Click Edit → textarea appears with raw markdown, Cancel exits without changes
  - [ ] Edit text, enter change reason, click Save → viewer updates with new content, version history shows new entry with source "manual"
  - [ ] Select two versions in diff dropdowns → side-by-side diff renders with green/red highlighting
  - [ ] "Exit Diff" returns to normal viewer
  - [ ] Click "Rollback" → previous version becomes active, version history updates
  - [ ] Log in as beta reader → contract page shows rendered contract and version history but NO Edit, Save, or Rollback buttons
- [ ] **Phase Review**:
  - [ ] PRD §2 "Edit contract" — save creates new manual version with parent_version_id
  - [ ] PRD §2 "Side-by-side diff" — two-version comparison with highlighted changes
  - [ ] PRD §2 "Rollback" — one-click, immediate UI update
  - [ ] PRD §2 "Write-gated" — canWrite hides edit/save/rollback for beta readers
  - [ ] PRD §6 out-of-scope respected — no persona_prompt editing, no AI suggestions, no markdown library

---
