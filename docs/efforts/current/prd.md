# Tier 1 Structured Writes — Product Requirements Document

## 1. Overview

The Tier 1 learning engine currently mutates `persona_prompt` by appending freeform text suffixes when it detects performance patterns (overconfidence, underconfidence, directional bias). This works but sits outside the structured contract format established in `analyst-contracts`. The audit system reads contracts from `context_markdown` — meaning Tier 1 adaptations are invisible to Tier 2 audit.

This effort moves learning-engine writes from `persona_prompt` suffix appending into the `## Adaptations` section of `context_markdown`, making Tier 1 changes structured, auditable, and consistent with the contract system.

## 2. Goals & Success Criteria

| Goal | Measurable Criterion |
|------|---------------------|
| Learning engine writes into `## Adaptations` | New config versions created by Tier 1 have updated `context_markdown` with adaptation entries; `persona_prompt` is unchanged from parent version |
| Adaptations are structured and parseable | `parseContractMarkdown()` returns adaptation entries from the updated contract |
| Carry-forward preserves adaptations | New config versions carry forward the full `context_markdown` including `## Adaptations` content (already works — verify) |
| Tier 2 audit sees Tier 1 changes | Audit prompt includes adaptation section content when checking contract-vs-output discrepancies |
| Paper mode uses updated contract | Paper-mode config versions carry the proposed `context_markdown` with new adaptations |
| Existing tests pass | Zero regressions in learning-engine, carry-forward, and contract-parsing test suites |
| New tests cover structured writes | Unit tests for adaptation formatting, section updating, and round-trip (write → parse → verify) |

## 3. User Stories / Use Cases

**System operator (founder):**
- When reviewing a Tier 2 audit finding, I can see what Tier 1 adaptations were active for that prediction's config version, because they're in the contract the audit reads.
- When reading an analyst's contract in the calibration drilldown or admin UI, I see a clear list of learning-engine adaptations with dates and reasons, not opaque prompt suffixes.

**Tier 2 audit system:**
- When checking contract-vs-output discrepancy, the audit LLM can reference specific adaptation entries (e.g., "contract says 'reduce confidence on bullish calls' but output shows 90% bullish confidence").

**Tier 1 learning engine:**
- When proposing an adjustment, writes a structured adaptation entry rather than a raw prompt suffix, producing a self-documenting audit trail.

## 4. Technical Requirements

### 4.1 Adaptation Entry Format

Each learning-engine adaptation written into `## Adaptations` follows this format:

```markdown
### <pattern-type> — <date>
<human-readable instruction derived from the pattern>
Source: tier1_auto | Confidence shift: <n>% | Weight shift: <n>
```

Example:

```markdown
## Adaptations

### Overconfident — 2026-04-10
Recent analysis shows confidence levels exceed accuracy. Be more conservative — only rate above 70% when evidence is very strong.
Source: tier1_auto | Confidence shift: -8% | Weight shift: 0

### Bearish Bias — 2026-04-07
Bullish calls have been significantly less accurate than bearish. Double-check reasoning when leaning bullish.
Source: tier1_auto | Confidence shift: 0% | Weight shift: 0
```

This format is:
- Human-readable (the instruction text is the same content currently appended to `persona_prompt`)
- Machine-parseable (heading pattern + metadata line)
- Auditable (date, source, and parameter shifts are explicit)

### 4.2 New Utility: `updateAdaptationsSection`

**File:** `apps/api/src/markets/utils/parse-contract-markdown.ts` (extend existing file)

```typescript
function updateAdaptationsSection(
  contractMarkdown: string,
  newEntry: AdaptationEntry,
): string
```

- Parses the contract, locates `## Adaptations`
- Appends the new entry after any existing entries
- Returns the full contract markdown with the updated section
- If `## Adaptations` section doesn't exist, creates it before any trailing sections

**Type:**
```typescript
interface AdaptationEntry {
  patternType: string;   // e.g. "Overconfident", "Underconfident", "Bearish Bias", "Bullish Bias"
  date: string;          // ISO date, e.g. "2026-04-10"
  instruction: string;   // The human-readable guidance text
  confidenceShift: number;
  weightShift: number;
}
```

### 4.3 Learning Engine Changes

**File:** `apps/api/src/markets/services/learning-engine.service.ts`

**Current flow (line ~244):**
```typescript
const proposedPrompt = analyst.persona_prompt + pattern.promptSuffix;
```

**New flow:**
1. Build an `AdaptationEntry` from the detected pattern
2. Call `updateAdaptationsSection(currentContextMarkdown, entry)` to produce updated contract
3. Create the new config version with:
   - `persona_prompt`: **unchanged** from parent version (no more suffix appending)
   - `context_markdown`: updated contract with new adaptation entry
4. The `change_reason` on the config version should reference the adaptation entry

**Paper mode activation** (line ~275): The carry-forward subselect already copies `context_markdown`. Verify that `activatePaperMode` passes the proposed `context_markdown` (with new adaptation) rather than relying solely on carry-forward from the parent.

### 4.4 Audit Integration

**File:** `apps/api/src/markets/services/audit.service.ts`

The audit already reads `context_markdown` from the config version (lines 389-418) and passes `sections.roles` and `sections.general` to the LLM prompt. **Add `sections.adaptations`** to the audit LLM prompt so the auditor can check whether the analyst followed its adaptation instructions.

Specifically, in the prompt construction (lines ~463-528), add an `ANALYST CONTRACT (Adaptations)` section when `sections.adaptations` is non-empty.

### 4.5 Prediction Runner Integration

**File:** `apps/api/src/markets/services/prediction-runner.service.ts`

Currently the prediction runner constructs the analyst prompt from `persona_prompt`. Since Tier 1 will no longer append to `persona_prompt`, the runner must also incorporate `context_markdown` adaptations into the prompt sent to the LLM. Verify whether the runner already includes `context_markdown` in the prompt; if not, append the `## Adaptations` content to the system prompt.

### 4.6 Data Model Changes

No schema changes required. The `context_markdown` and `persona_prompt` columns already exist on `analyst_config_versions`. This effort changes what gets written to them, not their structure.

## 5. Non-Functional Requirements

- **Backward compatibility:** Existing config versions with prompt suffixes in `persona_prompt` continue to work. No migration of historical data — old versions keep their `persona_prompt` suffixes. Only new Tier 1 proposals use structured writes.
- **Idempotency:** If the learning engine detects the same pattern type on consecutive nights, it should update the existing adaptation entry (same heading) rather than appending a duplicate.
- **Performance:** `updateAdaptationsSection` is string manipulation on small documents (contracts are < 2KB). No performance concerns.
- **Observability:** Learning proposals logged with the adaptation entry content, same as current prompt suffix logging.

## 6. Out of Scope

- **Migrating historical `persona_prompt` suffixes** into `## Adaptations` — old config versions retain their format.
- **Tier 2 or Tier 3 writes** — only Tier 1 autonomous writes are addressed.
- **Contract editor UI** — that's a separate future effort.
- **Changing the adaptation entry format for Tier 2** — audit findings remain in `audit_findings`, not in contracts.
- **Changing carry-forward logic** — it already preserves `context_markdown` across versions. Verify but don't redesign.
- **Changing the prediction runner's prompt construction beyond adaptation inclusion** — no refactor of how `persona_prompt` or `context_markdown` are assembled.

## 7. Dependencies & Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Prediction runner may not include `context_markdown` adaptations in LLM prompt | Adaptations written but never acted on | Phase 1 verifies runner behavior; fix if needed |
| `updateAdaptationsSection` corrupts contract markdown | Broken contracts, audit fails | Extensive unit tests with round-trip verification; parser is simple (heading-based splits) |
| Idempotent update (replacing same-type entry) loses prior adaptation history | Audit trail gaps for repeated patterns | Log replaced entry in `change_reason`; config version history preserves old contracts |
| Paper mode carry-forward doesn't pass proposed `context_markdown` | Paper predictions use stale contract | Verify in Phase 1; fix `activatePaperMode` if it relies on subselect instead of explicit param |

**Dependencies:** All dependencies (analyst-contracts, automated-meta-loop) are complete. No external dependencies.

## 8. Phasing

### Phase 1: Utility + Unit Tests
- Implement `updateAdaptationsSection` in `parse-contract-markdown.ts`
- Add `AdaptationEntry` type
- Unit tests: append single entry, append multiple entries, idempotent update of same pattern type, handle missing `## Adaptations` section, round-trip with `parseContractMarkdown`
- Verify carry-forward behavior with updated adaptations section (should already work)
- **Gate:** All unit tests pass, `parseContractMarkdown` round-trips correctly with adaptation entries

### Phase 2: Learning Engine Integration
- Refactor `learning-engine.service.ts` to build `AdaptationEntry` from each detected pattern
- Replace `persona_prompt + promptSuffix` with `updateAdaptationsSection(contextMarkdown, entry)`
- Write new config versions with updated `context_markdown` and unchanged `persona_prompt`
- Update `activatePaperMode` to pass proposed `context_markdown` explicitly if needed
- Update learning-engine tests to verify structured writes
- **Gate:** Learning engine tests pass, existing nightly-evaluation tests pass, new config versions have correct `context_markdown`

### Phase 3: Audit + Runner Integration
- Add `sections.adaptations` to audit LLM prompt in `audit.service.ts`
- Verify prediction runner includes adaptation content in analyst prompt; fix if needed
- Integration test: a config version with adaptations is correctly read by audit and runner
- **Gate:** All existing tests pass, audit prompt includes adaptations, runner prompt includes adaptations
