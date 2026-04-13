# Effort: Stripe Billing Integration

## Problem
No payment processing exists. Paid club tiers and power user expansion are blocked on billing infrastructure.

## Intention
Integrate Stripe for subscription management, enabling paid tiers (Free/Pro/University) for clubs and eventually power user features.

## Scope
- Stripe SDK integration in the API
- Customer creation on signup
- Subscription management (create, upgrade, downgrade, cancel)
- Webhook handling for payment events (success, failure, cancellation)
- Billing portal link for self-service management
- Pricing page with tier comparison
- Gating features by subscription tier

## Out of Scope
- Crowd-funded pricing model (future)
- Local hybrid desktop tier (future)
- Custom analyst marketplace (future)

## Dependencies
- Landing page (for public pricing display)
- Paid club tiers effort (defines what each tier includes)
