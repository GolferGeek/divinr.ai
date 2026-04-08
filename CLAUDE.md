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
