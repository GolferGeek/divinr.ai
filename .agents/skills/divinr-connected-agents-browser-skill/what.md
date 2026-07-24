# What — Connected agents

## Boundary flow

1. Apple Assistant creates a DPoP-signed device authorization request.
2. Divinr returns one short-lived user code and verification link.
3. `/connect/device` preserves that link through browser login.
4. The authenticated owner reviews immutable installation, key, scope, resource,
   expiry, and valueless-regtest authority data.
5. Exact typed `APPROVE` creates or reauthorizes one installation and grant;
   exact typed `DENY` closes the request.
6. `/settings/connected-agents` exposes safe lifecycle state. Its detail route
   allows exact typed `REVOKE GRANT` and `REVOKE AGENT` actions.

Credential issuance is intentionally absent in Phase 4. An approved token poll
returns a temporary-unavailable OAuth response until Phase 5.

## Source map

- Router: `apps/web/src/router/index.ts`
- Device view: `apps/web/src/views/DeviceConnectionView.vue`
- List view: `apps/web/src/views/ConnectedAgentsView.vue`
- Detail view: `apps/web/src/views/ConnectedAgentDetailView.vue`
- API composable: `apps/web/src/composables/useConnectedAgents.ts`
- Server controller: `apps/api/src/connected-agents/connected-agents.controller.ts`
- OAuth controller: `apps/api/src/oauth/oauth.controller.ts`

All financial context uses `<LegalDisclaimer variant="short" />`. Bitcoin is
explicitly labeled valueless regtest value.
