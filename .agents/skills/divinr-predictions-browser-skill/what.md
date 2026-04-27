# What — Predictions facet

## User flow

1. User is authenticated (session from storage state) and lands on the dashboard.
2. Sidebar → **Analyses** link (labelled "Analyses" in UI; route remains `/predictions`).
3. Page loads `GET /predictions?role=all`; backend returns an array of analysis rows.
4. User optionally changes the role filter (`all` / `analyst` / `arbitrator`); the view re-fires the same endpoint with the new `role` query param.
5. Each row shows direction chip, role chip, confidence, analyst name, timestamp.
6. When a prediction has a trade-eligible context, a trade-CTA appears; clicking it takes the user to the tournament trade form (ownership transfers to the tournaments skill).

## Surface shape

```
+------------------------------+
| Analyses                    | ← h1 copy (vocab compliant)
+------------------------------+
| Role: [All v]                | ← IonSelect
+------------------------------+
| [up] [analyst] Confidence: 72% | Alice  2026-04-19
| [down] [analyst] Confidence: 54% | Bob   2026-04-19
| ...                           |
+------------------------------+
| <FirstTouchPanel/>            |
+------------------------------+
```

## Data invariants

- Every rendered row must have a non-null `confidence` and `created_at`.
- Direction chip must resolve to `up`, `down`, or a neutral chip (no blank chip).
- The filter must be deterministic: switching from `all` → `analyst` strictly monotonically reduces (or leaves equal) the row count.

## Legal copy

The `<LegalDisclaimer>` variant `short` is attached at DashboardView level (parent route `/`). The predictions view does not embed its own disclaimer; navigate to `/` to verify disclaimer presence, or assert against the global header if one is added in a later effort.
