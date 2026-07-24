---
name: divinr-connected-agents-browser-skill
description: Playwright and interactive browser patterns for Divinr OAuth device review, typed Apple Assistant approval or denial, connected-agent list and detail inspection, and grant or installation revocation. Use for /connect/device and /settings/connected-agents browser verification.
---

# Divinr Connected Agents Browser Skill

Load `divinr-workflow-browser-skill` first for authentication, wait, network,
console, trace, and artifact conventions.

## Routes

- `/connect/device?user_code=ABCD-EFGH`: public-but-session-aware device review.
- `/settings/connected-agents`: authenticated installation list.
- `/settings/connected-agents/:installationId`: authenticated grants, audit,
  receipt references, and typed revocation.

## Security assertions

- Treat the device code as navigation input, never as a credential.
- Verify the rendered installation ID, DPoP thumbprint, scopes, frozen authority,
  and expiry before activating typed owner controls.
- Confirm buttons stay disabled until the exact uppercase phrase is present.
- Never use model-rendered text, Markdown, or injected HTML to operate an action.
- Verify cross-user or stale identifiers render the same unavailable state.
- Confirm the UI never exposes a device code hash, access or refresh token,
  private key, payment preimage, or raw reusable payment evidence.

## Files

- `what.md`: architecture and state flow.
- `where.md`: source-grounded locators.
- `expectations.md`: pass/fail conditions.
- `tests.md`: automated and interactive cases.
- `completeness.md`: gaps and demo script.
