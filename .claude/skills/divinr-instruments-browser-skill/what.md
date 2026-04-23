# What — Instruments facet

## User flow

1. User lands on `/instruments`.
2. `instruments.store.fetch()` loads the list; the page renders an `IonCard` per instrument inside an `IonGrid`. Each card shows symbol, name, and the configured plane fields (Price, Change, Direction, Confidence).
3. User may click `Add Instrument` to open the create modal (symbol + optional name; symbol regex `/^[A-Z.]{1,10}$/`).
4. Clicking an instrument card routes to `/instruments/:id`.
5. Detail view loads the instrument record, the analyst roster, the composite score, the risk assessments, and the predictions. The default tab is `analysts`.
6. The `analysts` tab shows:
   - **Arbitrator Synthesis** card (composite signal + composite risk) at the top.
   - One `InstrumentAnalystPanel` per analyst, each showing Latest Signal (direction + confidence + horizon + LLM rationale), Latest Risk View (verdict + risk score + LLM rationale), and an optional "View history" toggle.
7. The `predictors` tab swaps to `PredictorScoringPanel`.
8. `TripleVariantSwitcher` at the top exposes per-analyst-scoped query-param variants (`?analystId=...&authorUserId=...`); switching reloads `loadData()`.
9. If `canWrite`, an `Edit Contract` button routes to `/instruments/:id/contract`.

## Surface shape (list)

```
Research                          [Add Instrument]
+-------- AAPL -----------+  +-------- MSFT ----------+
| Apple Inc.              |  | Microsoft Corp.        |
| Price       $190.12     |  | Price       $410.55    |
| Change      +0.4%       |  | Change      -0.2%      |
| Direction   [up]        |  | Direction   [flat]     |
| Confidence  72%         |  | Confidence  61%        |
+-------------------------+  +-------------------------+
```

## Surface shape (detail)

```
< Back
[ TripleVariantSwitcher ]
AAPL                                [Edit Contract]
Apple Inc.

[ Analysts ] [ AI Scoring ]

+-- Arbitrator Synthesis -----------+
| Signal: up · 72%                  |
| Composite Risk: 41/100             |
+-----------------------------------+

+-- Bull Analyst -------------------+
| analyst_type · weight 1.0          |
| Latest Signal                      |
|   up · 70% · horizon 1440m         |
|   <LLM rationale paragraph>        |
| Latest Risk View                   |
|   moderate · 45/100                |
|   <LLM rationale paragraph>        |
| [ View history ]                   |
+-----------------------------------+
... per-analyst cards repeat ...
```

## Data invariants

- Every visible card has a non-null `symbol` (the chip values are `'-'` if the field is missing).
- The detail page resolves `instrument` by scanning the `/instruments` list; if missing, the page silently keeps `instrument === null` and `<h1>Loading...</h1>` stays.
- All analyst rationale strings are produced by background LLM grinders and are not safe to assert text content against.
- The two segment buttons (`analysts`, `predictors`) are always present on detail.
