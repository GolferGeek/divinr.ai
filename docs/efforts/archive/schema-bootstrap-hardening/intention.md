# Effort: Schema Bootstrap Hardening

## Problem

Divinr still performs schema mutation work from normal request paths. Multiple modules call `ensureSchema()` on first use, and a single shell load fans out into several modules at once: markets, billing, first-touch, learning panel, notifications, fear/greed, affinity, and others.

That pattern creates three concrete problems:

- request latency and cold-start instability
- intermittent `500` responses during normal shell bootstrap
- Postgres deadlocks and lock contention when multiple schema services perform DDL concurrently

This is no longer acceptable platform behavior. Before continuing feature work, the app needs deterministic startup and request handlers that assume the schema already exists.

## Intention

Remove request-time schema mutation as an application pattern and replace it with a **deterministic startup/bootstrap path**. Schema creation should belong to migrations and explicit initialization, not normal user traffic.

The effort should centralize bootstrap responsibility, eliminate first-request DDL races, and make shell loads reliable under concurrent traffic. The result should be that opening the app does not mutate the database and does not depend on request ordering.

## Scope

### Bootstrap Architecture

- inventory every `ensureSchema()` / request-time schema bootstrap path in the API
- define the target split between:
  - migrations for DDL
  - startup initialization for idempotent seed/default data
  - request handlers for normal business logic only
- introduce a single startup bootstrap flow or equivalent explicit initialization path
- ensure startup fails clearly when required schema is missing or incompatible

### Hot-Path Cleanup

Remove request-time schema bootstrap from the modules most likely to be hit during shell load:

- markets
- billing
- first-touch
- learning-panel
- notifications
- fear-greed alerts
- affinity
- messaging or onboarding if they are part of shell bootstrap

### Markets Schema Decomposition

`MarketsSchemaService` is currently too broad: DDL, legacy cleanup, seed data, preflight checks, and warnings are mixed together. This effort should separate those responsibilities enough that the runtime path is understandable and deterministic.

### Verification

- prove shell bootstrap no longer produces schema deadlock noise
- verify direct API calls and normal web shell loads succeed without first-request DDL
- keep all existing feature behavior intact

## Success Criteria

- no request handler performs schema mutation during normal user traffic
- shell bootstrap no longer emits schema deadlock errors
- app startup has one clear initialization path for required schema/bootstrap work
- learning-panel, billing, first-touch, and related shell surfaces load without intermittent bootstrap `500`s
- existing migrations / startup logic remain idempotent and repeatable in local dev

## Out of Scope

- Learning Panel Phase 5 metering/limits/feedback
- redesigning product features unrelated to bootstrap stability
- cloud/infrastructure migration
- broad database redesign beyond what is required to eliminate request-time schema work

## Dependencies

- `platform-learning-panel` remains paused after Phase 4 and resumes once shell/bootstrap stability is restored
- existing migration files under `apps/api/db/migrations/`
- existing schema services across the API that currently own request-time bootstrap behavior

## Open Questions for PRD Phase

- Should startup bootstrap run automatically inside the API process, or via a separate explicit command in dev/prod?
- Which seed/default-data steps must remain automatic, and which should become admin/manual/bootstrap commands?
- Do we want a temporary global bootstrap lock first, then a full migration away from `ensureSchema()`, or do we go straight to the end-state?
- Which shell bootstrap requests are still essential during initial page load, and which can be deferred?

---

*Stabilize the platform before more feature work: migrations own schema, startup owns initialization, requests own business logic.*
