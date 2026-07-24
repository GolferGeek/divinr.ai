# Expectations — Connected agents

## Device approval

- The code survives the login redirect exactly once.
- Review shows name, installation ID, full DPoP thumbprint, scopes, A2A resource,
  expiry, and authority profile version 2.
- The authority states 1–5¢ products, 10 successful calls, 25¢ cumulative,
  a 60-minute window, and valueless Bitcoin regtest.
- Approve is disabled unless the input equals `APPROVE`.
- Deny is disabled unless the input equals `DENY`.
- Success clears the immutable review so a second browser action cannot replay it.

## Connected-agent controls

- List and detail never disclose OAuth device codes, token material, or private keys.
- Detail shows grant status and scopes, safe audit entries, and receipt references.
- Grant revocation requires `REVOKE GRANT`.
- Installation revocation requires `REVOKE AGENT` and revokes all active grants.
- Unknown or cross-user identifiers use the same unavailable copy.

## Shared UI gates

- Desktop and 390px mobile widths have no horizontal document overflow.
- Every action has an accessible name and keyboard-operable input or button.
- First-touch content exists for device, list, and detail surfaces.
- Financial context routes through `LegalDisclaimer`.
- Outside disclaimers, user-visible copy contains no forbidden
  prediction, advice, or recommendation vocabulary.
- No unexpected 5xx, failed request, or uncaught console error occurs.
