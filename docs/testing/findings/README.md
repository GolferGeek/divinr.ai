# Testing Findings — Lifecycle

File-based queue for regressions surfaced by the Divinr.ai testing harness. Each finding is a single markdown file; the directory it lives in is its state.

## States

Findings move through five directories:

```
open/           new or reopened — needs triage
  ↓
triaged/        root cause attributed, severity set, assigned
  ↓
in-fix/         work in progress
  ↓
needs-verify/   fix landed; waiting for next harness run to confirm
  ↓
closed/         verified resolved (hash archived; a new open/ with the same hash is a P0 regression)
```

### Allowed transitions

- `open → triaged` — triage agent has categorized and assigned.
- `open → closed` — false positive or duplicate; record the reason in Notes.
- `triaged → in-fix` — someone started work.
- `triaged → closed` — wont-fix (record why in Notes).
- `in-fix → needs-verify` — fix committed; pending harness confirmation.
- `needs-verify → closed` — verify agent's next run passed.
- `needs-verify → in-fix` — verify run still failed; back to fix.
- `closed → open` — **regression**. Increment `regression-count` in frontmatter. Any hash that reappears here after being closed is **P0**.

## How to hand-move a finding

```sh
# example: open → triaged
git mv docs/testing/findings/open/<hash>-divinr-<slug>.md \
       docs/testing/findings/triaged/<hash>-divinr-<slug>.md
# update last-seen, severity, or other frontmatter as appropriate
```

Filename never changes during transitions — only the directory. The `{hash}` prefix is stable for the life of the finding and is how dedup works across runs.

## Filename convention

```
{8-char-hash}-divinr-{slug}.md
```

- `{8-char-hash}`: first 8 hex chars of `sha1("divinr:<spec-path>:<test-name>")` — produced by `apps/e2e/src/finding-hash.ts`.
- `divinr`: product prefix (shared lifecycle with Orchestrator and future products).
- `{slug}`: short human handle (kebab-case, ≤40 chars), e.g. `predictions-list-empty`.

## P0-regression rule

If a hash that currently lives in `closed/` reappears in `open/`, it is treated as **P0** regardless of the finding's original severity. The triage agent must surface these at the top of the next digest. `regression-count` in the frontmatter tracks how many times this has happened.

## Frontmatter schema

See `TEMPLATE.md` for the authoritative schema. Every finding file must have:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `product` | literal `divinr` | yes | enables future multi-product sharing |
| `severity` | `p0` \| `major` \| `minor` | yes | `p0` reserved for regressions + prod-blocking |
| `capability` | string | yes | facet/product area, e.g. `predictions`, `tournaments` |
| `surface-key` | string | yes | first-touch surface key or `n/a` for non-UI failures |
| `spec` | string | yes | path to the failing Playwright spec |
| `verify-command` | string | yes | exact command that reproduces the failure |
| `first-seen` | ISO-8601 UTC | yes | set once when created in `open/` |
| `last-seen` | ISO-8601 UTC | yes | updated on every harness run that re-observes |
| `regression-count` | integer | yes | `0` by default; increments on `closed → open` |
| `trace-artifact` | string \| null | yes | path to Playwright trace zip, or `null` |

## Growth convention

Any effort that adds or substantially changes a user-visible view is expected
to extend the testing harness alongside it — either update the corresponding
`.claude/skills/divinr-<facet>-browser-skill/tests.md` + add a spec under
`apps/e2e/tests/<facet>/`, or stub a new deep skill if the surface belongs to
a new facet. See the "Testing coverage on every user-facing surface" section
in the repo-root `CLAUDE.md` (mirrored by `verify-plan` §7 and `build-plan`
guidelines) for the Definition-of-Done wording.
