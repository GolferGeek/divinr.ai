# Contract Editor UI — Product Requirements Document

## 1. Overview

Analyst contracts (`context_markdown` on `analyst_config_versions`) drive predictions, audits, and learning — but admins have no UI for viewing, editing, or managing them. This effort adds a contract editor page for each analyst with rendered markdown, version history, side-by-side diff, inline editing, and one-click rollback. It integrates with the existing analyst list and Tier 2 findings inbox so admins can move fluidly between auditing and contract management.

## 2. Goals & Success Criteria

| Goal | Measurable Criterion |
|---|---|
| View active contract | Admin can see the full rendered `context_markdown` for any analyst |
| Version history | All config versions listed with source, timestamp, change reason |
| Side-by-side diff | Admin can select two versions and see changes highlighted |
| Edit contract | Admin can modify markdown, save creates new version (source: `manual`, parent_version_id linked) |
| Rollback | One-click rollback reflects immediately in the UI |
| Navigation from analyst list | Each analyst card on `/analysts` links to its contract editor |
| Navigation from findings | Each finding card on `/findings` links to the relevant analyst's contract |
| Write-gated | Edit, save, and rollback buttons hidden for beta readers (canWrite guard) |

## 3. User Stories / Use Cases

**Admin reviews a finding then edits the contract:** "I see a Tier 2 finding that the momentum analyst violated its sector-rotation rule. I click the analyst name on the finding card and land on the contract editor. I read the General section, find the rule, edit it for clarity, and save. The version history shows my manual edit with the change reason I entered."

**Admin reviews version history:** "I see the momentum analyst has 8 config versions — 3 manual, 4 tier1_auto, 1 tier2_approved. I select versions 5 and 7 to compare and see exactly what the Tier 1 learning engine changed in the Adaptations section."

**Admin rolls back a bad edit:** "I realize my last edit introduced confusion. I click Rollback, the previous version becomes active, and I can see it's restored."

**Beta reader views contract (read-only):** "I navigate to an analyst's contract page and can read the full rendered markdown and version history, but edit/save/rollback controls are not shown."

## 4. Technical Requirements

### 4.1 Architecture

New page: `/analysts/:id/contract` — a sibling route to the existing `/analysts/:id/performance`.

New API endpoints on the existing `markets.controller.ts`:
- `GET /analysts/:analystId/contract` — active contract + version history
- `PUT /analysts/:analystId/contract` — save edited contract (creates new config version)

Existing endpoint reused:
- `POST /analysts/:analystId/rollback` — already implemented with write-access guard

No new services — all logic lives in `MarketsService` which already has `getActiveContextForAnalyst()`, `rollbackAnalyst()`, and version-creation SQL patterns.

### 4.2 Data Model Changes

None. All required columns already exist on `analyst_config_versions`:
- `context_markdown` — the contract text
- `parent_version_id` — version chain
- `version_number`, `source`, `change_reason`, `created_at`, `created_by`
- `is_active` — which version is current

### 4.3 API Changes

#### `GET /analysts/:analystId/contract`

Returns the active contract and full version history.

**Response shape:**
```ts
{
  analystId: string;
  displayName: string;
  activeVersionId: string;
  contract: {
    markdown: string;
    sections: { general: string; roles: Record<string, string>; adaptations: string };
  } | null;
  versions: Array<{
    id: string;
    versionNumber: number;
    source: 'manual' | 'tier1_auto' | 'tier2_approved' | 'tier3_strategic';
    changeReason: string | null;
    createdBy: string | null;
    createdAt: string;
    isActive: boolean;
    contextMarkdown: string | null;
  }>;
}
```

The `versions` array includes `contextMarkdown` for each version so the frontend can compute diffs client-side without additional API calls.

**Auth:** Read access (all authenticated users).

#### `PUT /analysts/:analystId/contract`

Saves an edited contract by creating a new `analyst_config_versions` row.

**Request body:**
```ts
{
  markdown: string;       // the edited context_markdown
  changeReason?: string;  // optional reason for the edit
}
```

**Behavior:**
1. Deactivate the current active version (`is_active = false`).
2. Insert a new version with `source = 'manual'`, `parent_version_id` pointing to the previous active version, `context_markdown` set to the new markdown.
3. Update `market_analysts.current_config_version_id` to the new version.
4. Return the updated contract + version history (same shape as GET).

**Auth:** Write access required (uses existing `requireWriteAccess`).

### 4.4 Frontend Changes

#### New route
`/analysts/:id/contract` — name: `analyst-contract`

#### New view: `ContractEditorView.vue`

Layout (top to bottom):
1. **Header:** Analyst display name + link back to `/analysts`.
2. **Contract viewer:** Rendered markdown of the active `context_markdown`, using a `<pre>` block or simple HTML rendering of section headings and content. Not a full markdown renderer — the contract structure is predictable (## headings + text).
3. **Edit mode:** Toggle button (canWrite only) switches the viewer to a `<textarea>` with the raw markdown. Save button creates a prompt for change reason, then calls `PUT /analysts/:id/contract`.
4. **Version history panel:** Collapsible list of all versions, each showing version number, source chip (color-coded like kind badges), change reason, timestamp, created_by. Clicking a version loads its markdown into the viewer (read-only preview).
5. **Diff mode:** Two version-select dropdowns. Selecting two versions shows a side-by-side text diff. The diff is computed client-side using a simple line-by-line comparison (added/removed lines highlighted). No external diff library needed for structured markdown — a basic line diff is sufficient.
6. **Rollback button:** (canWrite only) Calls `POST /analysts/:id/rollback`, then refetches the contract data.

#### Navigation additions

**AnalystsView.vue:** Add a "Contract" button/link on each analyst card that navigates to `/analysts/:id/contract`.

**AuditFindingsView.vue:** Add the analyst name as a clickable `<router-link>` to `/analysts/:analystId/contract` on each finding card. The `analystId` is already present in the finding response.

#### No new store needed
The contract editor view can call `useApi()` directly for its two endpoints, following the same pattern as `AuditFindingsView.vue` (local refs, no Pinia store).

### 4.5 Infrastructure Requirements

None.

## 5. Non-Functional Requirements

- **Performance:** Version history includes full markdown for each version to enable client-side diff. For analysts with many versions (expected <30), this is fine. If version count grows large in the future, pagination can be added.
- **Security:** Write operations gated behind `requireWriteAccess` (existing). Read endpoints use existing auth middleware. Contract markdown is already visible to all authenticated users via the audit system.
- **Accessibility:** Edit mode uses a standard `<textarea>`. Version list and diff are plain HTML tables/divs. All interactive elements are buttons or links.

## 6. Out of Scope

- Editing `persona_prompt` or `tier_instructions` directly (legacy fields).
- AI-assisted contract generation or suggestions.
- Tier 3 strategic overhauls.
- Real-time collaborative editing.
- Changing the contract section structure or parser.
- Full markdown rendering library (the contract structure is simple enough for basic HTML).

## 7. Dependencies & Risks

| Risk | Mitigation |
|---|---|
| Large version history payload if an analyst accumulates many versions | Versions are expected to be <30 per analyst. The contract text is typically 1–3 KB. Total payload stays under 100 KB. |
| User accidentally saves a malformed contract | The `parseContractMarkdown` utility is tolerant (unrecognized headings are ignored, missing sections return empty strings). A malformed save won't crash the system — but it could degrade audit quality. A preview before save mitigates this. |
| Rollback when there's no parent version | The existing `rollbackAnalyst` already throws `BadRequestException('No previous version to rollback to')`. The frontend should handle this gracefully. |

## 8. Phasing

### Phase 1: API endpoints — contract read + version history

Add `GET /analysts/:analystId/contract` returning the active contract and version list. Wire up the controller, add the service method, test it.

### Phase 2: Contract viewer page + navigation links

Build `ContractEditorView.vue` with read-only contract display and version history list. Add the route. Add navigation links from `/analysts` cards and `/findings` cards.

### Phase 3: Edit, save, diff, and rollback

Add edit mode with textarea + save flow (`PUT /analysts/:id/contract`). Add version diff (side-by-side line comparison). Wire rollback button. Gate all write operations behind `canWrite`.
