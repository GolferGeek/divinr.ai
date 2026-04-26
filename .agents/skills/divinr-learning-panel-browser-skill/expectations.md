# Expectations — Learning Panel facet

## Pass criteria

1. `/chat` loads without redirecting to `/login`.
2. `Learning Panel` heading is visible.
3. Sending a message produces an assistant response.
4. The response renders `Grounded in` with at least one citation row.
5. Refresh preserves the latest prompt in the visible thread.
6. No local 5xx responses from `localhost:7100` or `localhost:7101` on the happy path.

## Failure severity

- P1 if `/chat` cannot bootstrap or refresh persisted history.
- P1 if assistant replies render with no visible content.
- P2 if citations are present in the payload but not rendered.
- P2 if user-facing vocabulary leaks forbidden terms outside the legal disclaimer.
