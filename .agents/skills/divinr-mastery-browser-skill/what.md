# What — Mastery facet

## User flow

1. A user lands in the shell at Level 1 and sees only the core loop in the left nav.
2. If they deep-link to a hidden surface, the router redirects them to `/chat` with context about what was hidden.
3. In onboarding settings, the user can opt into a higher-complexity level.
4. The shell reloads the new mastery profile and reveals the additional surfaces.

## Data invariants

- Level 1 hides clubs, authoring, and operator surfaces from the nav.
- Hidden-route fallback must never strand the user on a blocked URL.
- Updating the preferred mastery level persists and affects nav visibility after reload.
