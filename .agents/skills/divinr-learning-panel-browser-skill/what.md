# What — Learning Panel facet

## User flow

1. Authenticated user opens `/chat`.
2. The page calls `GET /api/learning-panel/bootstrap?surfaceKey=chat`.
3. If prior threads exist, the latest thread is fetched and rendered immediately.
4. User submits a question from the composer or a starter prompt.
5. The panel either creates a new thread or appends to the current one.
6. Assistant response renders inline with a citation list labeled `Grounded in`.
7. Refreshing the page should rehydrate the latest persisted thread.

## Surface shape

```
+--------------------------------------+
| Learning Panel                       |
| Ask about analyses, risk, ...        |
+--------------------------------------+
| message bubbles                      |
| assistant message                    |
| Grounded in                          |
| - Analysis & Signal — ...            |
+--------------------------------------+
| textarea                  [Send]     |
+--------------------------------------+
| <FirstTouchPanel surface-key="chat"> |
+--------------------------------------+
```

## Data invariants

- Bootstrap must not 404 or 500 on the happy path.
- The latest thread should be visible after refresh.
- Assistant replies must render citations when the backend returns them.
- User-facing copy on the route should use `analysis` / `signal`, not `prediction` / `recommendation` / `advice`, excluding the legal disclaimer.
