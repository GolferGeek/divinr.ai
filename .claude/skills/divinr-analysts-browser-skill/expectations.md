# Expectations — Analysts facet

Pass/fail invariants the smoke spec encodes. Each expectation maps to an
explicit `expect()` (or guarded skip annotation) in
`apps/e2e/tests/analysts/smoke.spec.ts`.

## Happy path — `/analysts`

1. **Route resolves**: `GET /analysts` returns 200 and the page does not
   redirect to `/login`.
2. **Heading renders vocab-compliant copy**: `<h1>Analysts</h1>` is
   visible. The match must be `^analysts$` so it cannot pass on a
   misrouted page that happens to contain the word "Analyst" in a longer
   string.
3. **Data arrives or explicit empty surface**: at least one
   `ion-grid ion-card` is visible within 10 s **OR** the
   `[surface-key="analysts"]` first-touch panel is visible. A blank grid
   with no first-touch panel is a finding (silent failure).
4. **No 5xx on the happy path**: every response from
   `divinr.ai` / `127.0.0.1:7100` / `127.0.0.1:7101` with status ≥ 500
   fails the spec. The spec scopes the assertion to those host patterns
   so external tracking pixels can't poison the result.

## Vocabulary invariant

Scan the rendered DOM with the legal-disclaimer + first-touch surfaces
removed:

```js
const clone = document.body.cloneNode(true);
clone.querySelectorAll('.legal-disclaimer, [data-testid="legal-disclaimer"], [surface-key], [data-surface-key]')
     .forEach((n) => n.remove());
clone.innerText;
```

Assert the remaining text does NOT match (case-insensitive):

- `\bprediction(s|ed|or)?\b`
- `\brecommendation\b`
- `\badvice\b`

If the assertion fails, **do not edit `apps/web/`**. Instead:

- Narrow the exclusion selector (e.g., also strip `surface-content`
  inline copy) until the legitimate copy passes, OR
- Document the leak as a finding in `completeness.md` and lower the
  severity of this invariant in the spec to a soft warning.

## Performance view (`/analysts/:id/performance`) — covered by deep spec, NOT the smoke

- Heading regex `/-- performance$/i` matches.
- The four aggregate tile titles are visible (`Accuracy`,
  `Avg Confidence`, `Calibration Score`, `Sample Size`).
- If `resolvedPredictions.length > 0`, expanding the first row triggers
  `GET /predictions/:id/llm-calls` and renders either a `pre.reasoning-pre`
  block or the "No captured reasoning" note (both are pass states).
- `[surface-key="analyst.detail"]` is present in the DOM.

## Contract view (`/analysts/:id/contract`) — covered by deep spec, NOT the smoke

- Heading regex `/— contract$/i` matches (literal em-dash).
- Either contract markdown is visible OR the
  "No contract markdown for this analyst." note is.
- "Version History" header is visible with a count in parentheses.
- For `canWrite` users: `Edit`, `Diff`, `Rollback` buttons render.
- `[surface-key="analyst.contract-viewer"]` is present in the DOM.

## Read-only invariant for the smoke

The smoke spec MUST NOT click `Create Analyst`, MUST NOT toggle enable
state, MUST NOT enter edit mode, and MUST NOT trigger rollback. Any
write action is reserved for future deep specs (and a transactional
fixture). Read-only navigation only.
