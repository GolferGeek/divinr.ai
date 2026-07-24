# Tests — Connected agents

Playwright project: `connected-agents`.

Specs:

- `apps/e2e/tests/connected-agents/device-connection.spec.ts`
- `apps/e2e/tests/connected-agents/settings.spec.ts`

## Automated cases

1. Unauthenticated device link retains its code in the login `redirect` query.
2. Authenticated desktop review renders every immutable field and requires exact
   typed approval.
3. Mobile review fits the viewport and exact typed denial is the only enabled action.
4. Settings list opens the owned installation detail.
5. Detail requires exact phrases for grant and installation revocation.
6. Safe audit and receipt empty and populated states render without reusable evidence.
7. First-touch and disclaimer components are present.
8. Non-disclaimer vocabulary and browser or network error gates remain green.

## Interactive browser pass

Use two fresh device requests. Complete login-return and approve the first; deny
the second. Open Connected Agents, inspect the first installation, revoke its
grant, then revoke the installation. Repeat review and detail at 390×844.

At each owner action, inspect disabled state before typing, try one near-match,
type the exact phrase, click once, reload the authoritative state, and inspect
console plus failed requests.
