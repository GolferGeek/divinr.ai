# Effort: Test — Auth & User Management

## Covers
- `auth-bootstrap` — JWT auth, RBAC, admin middleware
- `beta-user-share-path` — Invite-based signup, read-only beta readers, mutation guard
- `user-scoped-platform` — User-level ownership replacing organization-based multi-tenancy

## Testing Scope
- Login flow: JWT token issuance, localStorage persistence, auto-login on refresh
- Invite signup: token validation, account creation, beta-reader role assignment
- RBAC enforcement: admin vs user vs beta-reader access levels
- Mutation guard: beta readers cannot create/update/delete any resource
- User scoping: each user sees only their own data (instruments, portfolios, runs, etc.)
- Session management: logout clears state, expired tokens redirect to login

## Marketing Angle
What makes this worth mentioning to potential users — secure per-user accounts, invite-only beta access, role-based permissions.

## Chrome Testing
- Walk through login → dashboard → logout cycle
- Invite signup with valid/invalid tokens
- Beta reader sees "Read Only" badge, cannot trigger mutations
- Verify no cross-user data leakage

## Out of Scope
- Password reset (not implemented)
- OAuth/SSO (not implemented)
