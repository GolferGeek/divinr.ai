# Divinr.ai — Claude Notes

Conventions a future Claude needs to know before editing this repo.

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
