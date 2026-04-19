import type { Page } from '@playwright/test';

/**
 * Dismiss the first-touch WelcomeModal if it's open. Idempotent —
 * returns quickly if the modal isn't shown for this page load.
 */
export async function dismissWelcomeModal(page: Page): Promise<void> {
  const modal = page.locator('ion-modal.welcome-modal');
  await modal.first().waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
  if (!(await modal.first().isVisible().catch(() => false))) return;

  const skip = page.locator('ion-modal.welcome-modal button.skip-link').first();
  await skip.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  await skip.click({ timeout: 5000 }).catch(() => {});
  await modal.first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
}
