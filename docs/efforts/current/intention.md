# Intention: Beta-User Share Path

## What
Let someone other than the founder see the explainability surfaces. Create a lightweight invite flow that gives external beta users read-only access to predictions, reasoning, calibration, and audit findings — scoped to a single organization.

## Why
The full explainability loop is operational (analysts predict, evaluations score, reasoning is visible, contracts are audited, the meta-loop learns). But all of that has only ever been seen by one person. Before investing in polish, we need outside signal on whether the core value proposition — "you can see *why* the system thinks what it thinks" — actually resonates. That requires letting beta users in.

Today the system has JWT auth via Supabase, but no registration flow, no invite mechanism, and no read-only role. Every authenticated user has full write access to their org's data. There's no way to share a view without sharing credentials.

## Context
- Auth is Supabase JWT. Login is email/password → `POST /api/auth/login` → JWT.
- Multi-tenancy uses `organization_slug` on all domain tables. Users are mapped to orgs via Supabase RPC.
- The frontend router guards all routes except `/login`. There's no guest or read-only path.
- A `requireAdmin()` check exists in the markets controller but isn't enforced on any endpoint yet.
- The `@Public()` decorator exists for service endpoints but hasn't been applied to markets routes.
- All user-facing views (dashboard, runs, analysts, evaluations, findings, calibration, portfolios) are read-heavy — most of the value is in viewing, not mutating.

## Scope
- **Invite flow**: Admin (founder) can create invite links that grant read-only access to a specific org.
- **Read-only role**: A new `beta_reader` role that can access all GET endpoints for an org but cannot create, update, or delete anything.
- **Supabase user creation**: Invited users sign up via Supabase (email/password or magic link), get assigned `beta_reader` role and org membership.
- **Frontend enforcement**: Read-only users see the same views but mutation controls (buttons, forms) are hidden or disabled.
- **API enforcement**: `beta_reader` role is rejected by all mutation endpoints. Read endpoints work normally, scoped to the invited org.

## What this is NOT
- Not a public/anonymous share link system. Beta users must have accounts.
- Not a full RBAC overhaul. Two roles: `admin` (existing, full access) and `beta_reader` (new, read-only).
- Not a self-service signup. The founder creates invites; there's no open registration.
- Not a redesign of the UI for external audiences. Beta users see the same views the founder sees.

## Success criteria
- Founder can generate an invite link from the UI or CLI
- An external person can use that link to create an account and log in
- Once logged in, they see predictions, reasoning, calibration, and audit findings — read-only
- They cannot create runs, modify analysts, change sources, or review audit findings
- Existing founder access is unchanged
- The invite can be revoked (user removed from org)
