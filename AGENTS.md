# Divinr.ai — Codex Notes

Conventions a future Codex needs to know before editing this repo.

## Stripe local development

The API + Stripe webhook forwarder boot together via:

```bash
pnpm --filter @divinr/api run dev:up
```

That script (`apps/api/scripts/dev-up.sh`) kills any prior instance, starts
`node dist/src/main.js` in the background (logs at `/tmp/divinr-api.log`),
and — when `STRIPE_SECRET_KEY` is set in the repo-root `.env` — also starts
`stripe listen --forward-to localhost:7100/billing/webhooks/stripe`
(logs at `/tmp/divinr-stripe-listen.log`). The signing-secret prefix gets
echoed back so you can sanity-check it matches `STRIPE_WEBHOOK_SECRET` in
`.env`.

If `stripe` (the CLI) is missing, install with the prebuilt binary from
`https://github.com/stripe/stripe-cli/releases` (Ubuntu ARM64 → `linux_arm64.tar.gz`)
into `~/.local/bin/`, then `~/.local/bin/stripe login --non-interactive`
and follow the URL it prints.

The whole pipeline is gated on `STRIPE_SECRET_KEY` presence — when unset,
every Stripe code path returns `null` / no-op and the app behaves exactly as
it did before billing was wired. To run the API without Stripe, just comment
out `STRIPE_SECRET_KEY` in `.env` and re-run `dev:up`.

## NestJS DI: always use explicit `@Inject(ClassName)` on every constructor param

The API runs tests via `tsx` (esbuild), which does **not** emit TypeScript's
`design:paramtypes` reflect metadata. Type-based NestJS DI silently fails at
runtime — the param resolves to `undefined` and the service crashes when first
constructed.

**Wrong** (compiles, lints, builds, dies at runtime):
```ts
constructor(private readonly foo: FooService) {}
```

**Right** (the codebase convention):
```ts
constructor(@Inject(FooService) private readonly foo: FooService) {}
```

Apply this to every constructor parameter without exception, including injection
tokens like `@Inject(DATABASE_SERVICE)`. Grep any service in
`apps/api/src/markets/services/` for the established pattern.

## First-touch coverage on every user-facing surface

Every new user-facing surface (view, modal, drawer, substantial interactive
component) ships with a `useFirstTouch('<surface-key>')` call (or a
`<FirstTouchPanel :surface-key="...">` wrapper) **and** a corresponding entry
in `apps/web/src/onboarding/surface-content.ts`. This is part of Definition
of Done for any effort that adds or substantially changes a user-visible
surface.

The inventory is authoritative (seed list: PRD Appendix A in
`docs/efforts/archive/onboarding-tour-extended/prd.md`). Updates to the
inventory land with the effort that introduces the new surface. Keys whose
backing view does not yet exist stay in
`apps/web/src/onboarding/pending-surfaces.md` until wired.

The coverage check script
(`apps/web/scripts/check-first-touch-coverage.mjs`) enforces the inventory /
surface-content / wired-or-pending invariant at build time.

## Testing coverage on every user-facing surface

Every new user-visible surface ships a first-touch content entry AND either
extends an existing deep testing skill or stubs a new one. Definition of Done
for any effort touching a user-visible view.

The deep skill inventory lives in
`.Codex/skills/divinr-platform-browser-skill/SKILL.md`. Each facet has a
`divinr-<facet>-browser-skill/` folder with six files (SKILL, what, where,
expectations, tests, completeness) plus at least one green Playwright spec
under `apps/e2e/tests/<facet>/`. When an effort adds a new user-visible view:

- If the view belongs to an existing facet, update that facet's `tests.md`
  and add/extend a spec under `apps/e2e/tests/<facet>/`.
- If the view belongs to a new facet, stub a new deep skill (six files) +
  add a new Playwright project in `apps/e2e/playwright.config.ts` + at least
  one green spec.

The `verify-plan` skill enforces this (§7 Testing coverage) — any plan that
adds a user-visible view without a testing-coverage step is flagged Major.

## UI vocabulary: analysis/signal, never prediction/advice

User-visible copy in `apps/web/src` uses **"analysis"** or **"signal"** — never
**"prediction," "predicted," "predictor," "advice,"** or **"recommendation."**
This applies to Vue templates, rendered string literals, onboarding
`surface-content.ts` titles/bodies, toasts, errors, labels, and
`aria-label`/`title`/`alt`/`placeholder` attributes.

**Code identifiers are exempt** — store names, type names, variable names,
function names, component filenames, API request/response shape keys
(`prediction_id`, `predictions[]`), DB schema, migrations, route paths
(`/predictions/:id`), telemetry events, and HTML/JS comments may retain domain
terminology. Admin/debug surfaces may also retain domain terminology where it
aids maintenance.

**Disclaimers** route through `<LegalDisclaimer>` at
`apps/web/src/components/LegalDisclaimer.vue`. Five variants are defined in
`apps/web/src/onboarding/disclaimers.ts`: `short`, `full`, `trade-cta`,
`tournament`, `club`. Do not write new inline disclaimer copy — add a variant
if a new context genuinely needs one. Every variant must state both "not a
prediction model" and "not investment advice."

Rationale and the original dictionary live in
`docs/efforts/archive/ui-vocabulary-and-marketing-refresh/` (once archived).
The authoritative current feature inventory is `docs/features.md`.
