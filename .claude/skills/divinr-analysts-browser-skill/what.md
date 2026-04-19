# What — Analysts facet

## User flow

1. Authenticated user (storage state) navigates to `/analysts` from the sidebar.
2. `AnalystsView` calls `useAnalystsStore().fetch()` on mount → `GET /analysts`. The result populates an `IonGrid` of `IonCard`s.
3. Each card surfaces the analyst's display name, type/weight/scope, persona excerpt (200 chars), and per-card chips (`Default` for system analysts, `Disabled` when `is_enabled=false`).
4. Two router-link buttons per card open the deep views:
   - **Contract** → `/analysts/:id/contract` (`ContractEditorView`)
   - **Performance** → `/analysts/:id/performance` (`AnalystPerformanceView`)
5. Admins / owners (`canWrite`) see an enable toggle inline on each card and a `Create Analyst` button in the page header that opens an `IonModal` form (slug / display name / persona prompt → `POST /analysts`).
6. Performance view loads `GET /analysts/:id/calibration` and renders aggregate tiles, per-instrument table, scatter plot (lazy `CalibrationScatter`), and an expandable list of resolved analyses. Expanding a row triggers `GET /predictions/:id/llm-calls` once and caches the result.
7. Contract view loads `GET /analysts/:id/contract`. Modes:
   - **Viewer** (default) — markdown rendered as section blocks parsed on `^## ` headings.
   - **Preview** — clicking a non-active version in history loads that version's markdown into the viewer with a banner.
   - **Edit** — textarea + change-reason input. `Save` → `PUT /analysts/:id/contract`; on 400 with `missingSections`/`forbiddenPhrases`/`extraSections`, render structured validation errors.
   - **Diff** — two version selectors + side-by-side line diff with green/red highlighting.
   - **Rollback** — `POST /analysts/:id/rollback` rolls active to previous version.

## Surface shape — `/analysts`

```
+----------------------------------------------------------+
| Analysts                                  [+ Create]      | ← <h1>Analysts</h1> + admin button
+----------------------------------------------------------+
| [Card: Sentiment Sam     Default]  [Card: Macro Mary  ]   |
|  personality | 0.5 | dashboard      personality | 0.7 |..  |
|  "You are Sentiment Sam..."         "You are Macro Mary..." |
|  [Contract] [Performance]           [Contract] [Performance]|
|  [Toggle: Enabled]                  [Toggle: Enabled]       |
+----------------------------------------------------------+
| <FirstTouchPanel surface-key="analysts" />                 |
+----------------------------------------------------------+
```

## Data invariants

- `display_name`, `analyst_type`, `default_weight`, `workflow_scope`, `persona_prompt`, `is_enabled`, `is_system_default` are all expected on every row from `GET /analysts`.
- A disabled analyst still renders, just with the `Disabled` chip and the toggle in the danger color.
- Every analyst has a contract; an analyst with zero versions still resolves the contract endpoint but renders the "No contract markdown for this analyst." note.

## Vocabulary

User-visible copy on the three analyst routes uses **"analysis"** / **"analyses"** / **"signal"** — not "prediction." Documented exemptions:

- Code identifiers (variable / type names, `surface-key`s, route names like `analyst-performance`, internal API paths like `/predictions/:id/llm-calls`) are exempt per CLAUDE.md.
- The `<LegalDisclaimer>` slot wherever rendered may say "not a prediction model" — vocabulary checks must exclude `.legal-disclaimer` / `[surface-key]` subtrees.
