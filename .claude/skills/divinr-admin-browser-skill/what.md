# What — Admin facet

Admin surfaces may retain domain terminology where it aids maintenance (per
CLAUDE.md). The vocabulary rule is RELAXED for this facet — forbidden words
"prediction" / "predicted" / "predictor" / "advice" / "recommendation" are
allowed in admin copy.

## Surface inventory

| Route                                         | View                          | What it shows                                                                                  |
| --------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `/admin/cost/calibration`                     | `CostCalibrationView.vue`     | Rolling per-model cost averages from the LLM usage log + drift alerts table + refresh button. |
| `/admin/cost/defensibility`                   | `CostDefensibilityView.vue`   | Pricing-defensibility analysis: which tiers/models have margin headroom vs are loss-leading.  |
| `/admin/cost/experiments`                     | `CostExperimentsView.vue`     | List of cost experiments (model swaps / prompt-cache trials / batch routing).                  |
| `/admin/cost/experiments/:id`                 | `CostExperimentsView.vue`     | Same view, scoped to a single experiment (uses `:id` route param).                              |
| `/admin/attribution`                          | `AttributionAdminView.vue`    | Coverage roll-up across all attributed instruments / sources / analysts.                        |
| `/admin/attribution/sources`                  | `SourceQualityView.vue`       | Per-source quality leaderboard (cite-rate, lift, freshness, dead-link rate).                    |
| `/admin/attribution/graduation-candidates`    | `GraduationCandidatesView.vue`| Sources / analysts ready to graduate from beta to GA based on attribution thresholds.           |
| `/usage`                                      | `UsageDashboardView.vue`      | LLM usage dashboard (operator surface; in the Admin sidebar group).                             |
| `/findings`                                   | `AuditFindingsView.vue`       | Audit findings queue (operator surface; in the Admin sidebar group).                            |
| `/proposals`                                  | `ProposalsView.vue`           | Strategic proposals queue (operator surface; in the Admin sidebar group).                       |

## User flow (calibration as the canonical example)

1. Operator authenticates (storage state holds a session with admin role).
2. Sidebar → **Admin → Cost Modeling → Calibration**. Route resolves to `/admin/cost/calibration`.
3. `onMounted` fires `usageStore.fetchCalibration()` and `usageStore.fetchDriftAlerts()`.
4. Heading "Cost Calibration" (h2) and the explanatory line "Per-model rolling cost averages from the LLM usage log. Estimates only — actual provider invoices remain authoritative." render immediately.
5. The data table renders one row per `(model, provider)`; below 50 samples a "Insufficient samples" pill is shown.
6. If `driftAlerts.length > 0`, a warning card with an action column ("Acknowledge" button per unacknowledged alert) appears above the main table.
7. Clicking **Refresh now** posts to the calibration-refresh endpoint, then updates the summary line ("Refreshed N model(s), raised N alert(s), skipped N.").

## Surface shape (calibration)

```
+-----------------------------------------------------------+
| Cost Calibration                                          | <- h2
| Per-model rolling cost averages from the LLM usage log... |
+-----------------------------------------------------------+
| [ Refresh now ]   <spinner>   Refreshed 3 model(s), ...   |
+-----------------------------------------------------------+
| Drift alerts (N)                                          | <- only if alerts > 0
| | Model | Provider | Drift | Samples | Detected | [Ack] | |
+-----------------------------------------------------------+
| | Model | Provider | Samples | Avg cost | $/M in | ... | | <- main table
| | gpt-4o-mini | openai | 1,420 | $0.0042 | $0.50 | ... | |
| | gemma-2b    | local  | 18    | $0.0001 | $0.00 | ... | <- "Insufficient samples"
| ...                                                       |
| | (empty row when calibration.length === 0)               |
+-----------------------------------------------------------+
| <FirstTouchPanel surface-key="admin.cost-modeling.calibration"/>
+-----------------------------------------------------------+
```

## Data invariants

- Heading copy on `/admin/cost/calibration` MUST read "Cost Calibration" exactly (h2). Other admin views ship their own h1 / h2; see `where.md`.
- Empty state: when no calibrated rows exist, the table MUST render its single explanatory `<td colspan="8">` row instead of an empty `<tbody>`.
- The Refresh button MUST be disabled while a refresh is in flight (`refreshing.value === true`).
- Drift-alert card is conditional (`v-if="store.driftAlerts.length > 0"`). Its absence is normal in a healthy environment.

## Legal copy

Admin surfaces do not embed `<LegalDisclaimer>` and are not user-facing in the
consumer sense. Do not assert disclaimer presence here.
