# Expectations — Mastery facet

## Pass criteria

1. Level 1 hides clubs and authored-content nav items.
2. Deep-linking to `/clubs` at Level 1 redirects to `/chat` with a hidden-surface notice.
3. Choosing `Competitive Participation` in onboarding settings persists and reveals `Clubs`.
4. After opting up, `/clubs` no longer redirects away.

## Failure severity

- P1 if the shell still exposes most of the app at Level 1.
- P1 if hidden-route fallback loops or leaves the user on a blocked page.
- P2 if the settings control updates the backend but the shell does not reflect it after reload.
