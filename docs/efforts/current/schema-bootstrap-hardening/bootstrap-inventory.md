# Schema Bootstrap Inventory

Phase 1 inventory for `schema-bootstrap-hardening`.

## Shell Bootstrap Requests

Authenticated shell load currently fans out from [DefaultLayout.vue](/Users/golfergeek/projects/divinr.ai/divinr.ai-codex/apps/web/src/layouts/DefaultLayout.vue) on initial mount:

| Surface | Frontend trigger | API path | Essential | Runtime schema owner today |
| --- | --- | --- | --- | --- |
| Affinity alerts | `affinityStore.fetchContrarianAlerts(true)` | `GET /api/markets/affinity/alerts?unread_only=true` | Deferrable | `MarketsSchemaService` via `AffinityService` |
| Notifications unread | `notificationStore.fetchUnreadCount()` | `GET /api/markets/notifications/unread-count` | Deferrable | `MarketsSchemaService` via `NotificationService` |
| Fear/greed unread | `fearGreedStore.fetchUnreadCount()` | `GET /api/markets/fear-greed-alerts/unread-count` | Deferrable | `MarketsSchemaService` via `FearGreedAlertService` |
| Messaging unread | `messagingStore.fetchUnreadCounts()` | `GET /api/markets/messaging/unread-counts` | Deferrable | `MessagingSchemaService` |
| Onboarding profile | `onboarding.fetch()` | `GET /api/onboarding` | Essential | `OnboardingSchemaService` |
| First-touch state | `firstTouchStore.fetch()` | `GET /api/first-touch` | Essential | `FirstTouchSchemaService` |
| Billing status | `billing.fetch()` | `GET /api/billing/status` | Essential | `BillingSchemaService` |
| Learning Panel bootstrap | Learning Panel open or `/chat` load | `GET /api/learning-panel/bootstrap` | Deferrable for shell, essential for panel | `LearningPanelSchemaService`, plus `FirstTouchSchemaService` and `OnboardingSchemaService` through the panel context service |

Classification rule for later phases:

- **Essential** means the shell or route is materially incomplete without the data and should assume bootstrap/readiness is already satisfied at startup.
- **Deferrable** means the shell can remain interactive while the request resolves, retries, or temporarily fails.

## Runtime Schema Ownership by Module

This is the Phase 1 grouping from `rg -n "ensureSchema\\(" apps/api/src`.

| Module / service family | Current runtime schema owner | Current role |
| --- | --- | --- |
| Markets | `MarketsSchemaService` plus many markets-adjacent services | Mixed DDL, seed/default data, verification/warnings, and business-path dependency |
| Billing | `BillingSchemaService` | DDL and business-path dependency |
| Learning Panel | `LearningPanelSchemaService` | DDL and business-path dependency |
| First-touch | `FirstTouchSchemaService` | DDL and business-path dependency |
| Onboarding | `OnboardingSchemaService` | DDL and business-path dependency |
| Messaging | `MessagingSchemaService` | DDL and business-path dependency |
| Credentials | `CredentialsSchemaService` | DDL and business-path dependency |
| Clubs | `ClubSchemaService` | DDL, seed/default data, and business-path dependency |
| Tournaments | `TournamentSchemaService` | DDL and business-path dependency |
| Curriculum | `CurriculumSchemaService` | DDL and business-path dependency |
| Auth invite + service keys | `InviteService.ensureSchema()` and `ServiceApiKeyService.ensureSchema()` | DDL embedded directly in service lifecycle / hot path |

## Transition Rules for This Effort

1. Runtime `ensureSchema()` remains temporarily allowed only behind the process-wide coordinator added in Phase 1.
2. New schema work must not add fresh request-time DDL to normal request handlers.
3. Later phases move responsibilities into:
   - **Migrations** for DDL.
   - **Explicit bootstrap** for idempotent seed/default data.
   - **Startup readiness** for verification and fail-fast checks.
4. Shell-hot modules are removed from request-time schema mutation first:
   - markets shell endpoints
   - billing
   - first-touch
   - onboarding
   - messaging unread counts
   - learning-panel bootstrap
5. `MarketsSchemaService` is treated as the highest-risk decomposition target because it mixes schema creation, seed data, warnings, and broad feature dependencies.
