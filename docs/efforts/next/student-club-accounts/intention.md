# Effort: Student Club Accounts

## Problem

Students are a high-leverage early audience — they're already coordinating in investing clubs (St. Thomas Investing Club is the proof point), they have time to engage deeply, and a graduating student becomes a working professional with a Divinr habit. But the current club model has no notion of "this is a student club," no automatic credentialing, and no graceful handling of the moment a student stops being a student.

## Intention

Add a first-class **Student Club** type that uses `.edu` email verification as the membership credential. Free during beta, structured so that flipping to paid is a config change rather than a rebuild. Membership naturally lapses when the student graduates and loses their `.edu` address, providing a self-cleaning credential without manual offboarding.

## Scope

### New Club Type

- "Student Club" as a distinct club kind alongside the regular paid clubs
- St. Thomas Investing Club is the first instance
- Inherits the standard club model from `divinr-basic-club-model`: opt-outs, tournaments, club-scoped analysts/sources

### .edu Membership Gating

- Membership requires a verified `.edu` email on file
- Periodic re-verification cadence (TBD — quarterly? on each login? on bounce?)
- Loss of `.edu` validity → membership transitions to a graceful "alumni" state, not a hard kick

### Free-Now, Paid-Ready Architecture

- Pricing is $0/mo at launch
- Plumbing (subscription record, billing hooks, entitlements) is wired the same way a paid club would be
- Flipping to paid is changing a `monthly_price_cents` value, not adding a billing system

### Alumni Off-Ramp (the natural funnel)

- When .edu lapses, student is offered conversion to regular Divinr Basic
- Their portfolio, predictions, and history stay intact through the transition
- Tournament participation history follows them into Basic

## Open Questions for PRD Phase

- How aggressive is the .edu re-verification? Annual? On every login? Only on bounce?
- What does the alumni transition look like — silent, email-prompted, in-app modal?
- Can a club admin (faculty advisor) manually approve non-.edu members for edge cases?
- Does a Student Club have a different default analyst/source bundle than Divinr Basic, or is it Basic + identity?

## Success Criteria

- St. Thomas Investing Club operates as a Student Club instance with .edu-gated membership
- A graduating student has a graceful path into regular Basic without losing their data
- Flipping student clubs to paid in the future requires only a price config change

## Out of Scope

- The actual paid pricing for student clubs (decided when we flip the switch)
- Billing/Stripe wiring (depends on the rescoped `stripe-integration` effort)
- Faculty/advisor admin tooling beyond what `divinr-basic-club-model` provides

## Dependencies

- `divinr-basic-club-model` must land first — Student Club is a specialization of the club shape that effort defines

---

*Stub — to be expanded after `divinr-basic-club-model` settles the base club shape.*
