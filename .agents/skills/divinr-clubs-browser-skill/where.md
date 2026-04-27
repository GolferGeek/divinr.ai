# Where — Clubs locators

## List page (`/clubs`)

Page heading:

```ts
page.getByRole('heading', { name: /^clubs$/i, level: 1 })
```

Header buttons:

```ts
const rankings = page.getByRole('button', { name: /^rankings$/i });
const createClub = page.getByRole('button', { name: /^create club$/i }); // visible only when canWrite
```

Top tab segment (My Clubs / Discover):

```ts
const mineTab = page.locator('ion-segment-button[value="mine"]');
const discoverTab = page.locator('ion-segment-button[value="discover"]');
```

Club cards (covers both tabs — same `IonCard` markup):

```ts
const cards = page.locator('.clubs-page ion-card');
await expect(cards.first()).toBeVisible({ timeout: 10_000 });
```

Empty states:

```ts
const empty = page.locator('.clubs-page .empty');
// My Clubs empty text:   "No clubs yet. Create one or join with an invite code!"
// Discover empty text:   "No public clubs yet."
```

Sprint chips on My Clubs cards:

```ts
const sprintActive = page.locator('ion-chip.sprint-chip', { hasText: /sprint active/i });
const sprintUpcoming = page.locator('ion-chip.sprint-chip', { hasText: /sprint starts/i });
```

Unread-activity badge:

```ts
const unread = page.locator('.clubs-page .unread-badge');
```

## Detail page (`/clubs/:id`)

Heading:

```ts
page.getByRole('heading', { level: 1 }) // text is the dynamic club name
```

Member-view tab bar (scrollable `IonSegment.club-tabs`):

```ts
const tabBar = page.locator('ion-segment.club-tabs');
const memberTab     = page.locator('ion-segment.club-tabs ion-segment-button[value="members"]');
const analystsTab   = page.locator('ion-segment.club-tabs ion-segment-button[value="analysts"]');
const activitiesTab = page.locator('ion-segment.club-tabs ion-segment-button[value="activities"]');
const analyticsTab  = page.locator('ion-segment.club-tabs ion-segment-button[value="analytics"]');
const curriculumTab = page.locator('ion-segment.club-tabs ion-segment-button[value="curriculum"]');
const mentoringTab  = page.locator('ion-segment.club-tabs ion-segment-button[value="mentoring"]');
```

Switch tab via deep-link (preferred over click since `IonSegment` change events can be flaky):

```ts
await page.goto(`/clubs/${clubId}?tab=analytics`);
```

Members tab — member rows:

```ts
const memberRows = page.locator('ion-card.clickable-member');
```

Member profile drawer (opens on member row click):

```ts
const drawer = page.locator('ion-modal'); // MemberProfileDrawer mounts as a modal
```

Invite / Chat actions (member view, desktop):

```ts
const invite = page.getByRole('button', { name: /^invite$/i });
const chat = page.getByRole('button', { name: /^chat$/i });
```

Mobile action menu trigger:

```ts
const mobileActionsTrigger = page.locator('#club-actions-trigger');
```

Non-member preview panel:

```ts
const preview = page.locator('.clubs-page .club-preview, [data-testid="club-preview"]'); // ClubPreviewPanel root
```

Active tournament banner:

```ts
const banner = page.locator('.active-tournament-banner, [data-testid="active-tournament-banner"]');
```

Legal disclaimer:

```ts
const disclaimer = page.locator('.legal-disclaimer, [data-testid="legal-disclaimer"]');
```

## Vocabulary exclusion selectors (shared with other facets)

```ts
const VOCAB_EXCLUDE = '.legal-disclaimer, [data-testid="legal-disclaimer"], [surface-key], [data-surface-key]';
```
