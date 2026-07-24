import { expect, test, type Page, type Route } from '@playwright/test';

const INSTALLATION_ID = 'apple-installation-demo-001';
const GRANT_ID = 'grant-demo-001';

const AGENT = {
  installationId: INSTALLATION_ID,
  displayName: 'Gary’s Mac Studio Assistant',
  dpopJkt: '4B8vbwS0f4M8Gv7gWQ_frozen_thumbprint_demo',
  status: 'active',
  approvedScopes: ['commerce:purchase', 'receipts:read', 'updates:read'],
  createdAt: '2026-07-24T17:00:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
  grants: [{
    grantId: GRANT_ID,
    status: 'active',
    scopes: ['commerce:purchase', 'receipts:read', 'updates:read'],
    validFrom: '2026-07-24T17:00:00.000Z',
    validUntil: '2026-08-23T17:00:00.000Z',
    approvedAt: '2026-07-24T17:00:00.000Z',
    openAuthorityRef: 'ap2-open-authority-profile:v0.2',
  }],
};

async function fulfillShared(route: Route): Promise<boolean> {
  const path = new URL(route.request().url()).pathname;
  if (path === '/api/first-touch/state') {
    await route.fulfill({ json: { muted: false, touched: [
      'settings.agent-device-connection',
      'settings.connected-agents',
      'settings.connected-agent-detail',
    ] } });
    return true;
  }
  if (path.startsWith('/api/first-touch/')) {
    await route.fulfill({ json: { ok: true } });
    return true;
  }
  if (path === '/api/mastery/profile') {
    await route.fulfill({ json: {
      currentLevel: 'core_trading',
      preferredLevel: 'core_trading',
      evidence: {},
    } });
    return true;
  }
  if (path === '/api/billing/status') {
    await route.fulfill({ json: {
      status: 'active',
      trial_ends_at: null,
      expired_at: null,
      purge_scheduled_at: null,
      is_read_only: false,
      days_until_purge: null,
      has_card_on_file: true,
      is_student: false,
    } });
    return true;
  }
  return false;
}

async function configure(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('divinr_user', '20000000-0000-0000-0000-000000000001');
    localStorage.setItem('divinr_token', 'browser-test-token');
    localStorage.setItem('divinr_role', 'member');
  });
  await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    if (await fulfillShared(route)) return;
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/connected-agents') {
      await route.fulfill({ json: [AGENT] });
      return;
    }
    if (path === `/api/connected-agents/${INSTALLATION_ID}`) {
      await route.fulfill({ json: {
        ...AGENT,
        audit: [{
          eventId: 'audit-1',
          action: 'agent.installation.approved',
          outcome: 'succeeded',
          reason: null,
          detail: { authorityProfileVersion: 2 },
          occurredAt: '2026-07-24T17:00:00.000Z',
        }],
        receipts: [],
      } });
      return;
    }
    if (path.includes('/revoke')) {
      await route.fulfill({ json: { status: 'revoked' } });
      return;
    }
    await route.fulfill({ status: 200, json: {} });
  });
}

test.describe('connected-agent settings', () => {
  test.beforeEach(async ({ page }) => configure(page));

  test('list opens an owned installation and shows safe evidence', async ({ page }) => {
    await page.goto('/settings/connected-agents');
    await expect(page.getByRole('heading', { name: 'Connected Agents', level: 1 })).toBeVisible();
    await expect(page.getByText(AGENT.displayName)).toBeVisible();
    await page.getByRole('button', { name: `Inspect ${AGENT.displayName}` }).click();
    await expect(page).toHaveURL(new RegExp(`/settings/connected-agents/${INSTALLATION_ID}$`));
    await expect(page.getByText('agent.installation.approved')).toBeVisible();
    await expect(page.getByText(/no payment or service receipt references yet/i)).toBeVisible();
    await expect(page.getByText(/access_token|refresh_token|device_code/i)).toHaveCount(0);
  });

  test('grant and installation revocation require exact typed phrases', async ({ page }) => {
    let grantRevoked = false;
    let agentRevoked = false;
    await page.route('**/api/connected-agents/**/revoke', async (route) => {
      const path = new URL(route.request().url()).pathname;
      grantRevoked ||= path.includes('/grants/');
      agentRevoked ||= !path.includes('/grants/');
      await route.fulfill({ json: { status: 'revoked' } });
    });
    await page.goto(`/settings/connected-agents/${INSTALLATION_ID}`);

    const grantButton = page.getByTestId(`grant-revoke-${GRANT_ID}`);
    await expect(grantButton.locator('button')).toBeDisabled();
    await page.getByTestId(`grant-revoke-confirmation-${GRANT_ID}`).locator('input').fill('REVOKE');
    await expect(grantButton.locator('button')).toBeDisabled();
    await page.getByTestId(`grant-revoke-confirmation-${GRANT_ID}`).locator('input').fill('REVOKE GRANT');
    await grantButton.click();
    expect(grantRevoked).toBe(true);

    const agentButton = page.getByTestId('agent-revoke');
    await expect(agentButton.locator('button')).toBeDisabled();
    await page.getByTestId('agent-revoke-confirmation').locator('input').fill('REVOKE AGENT');
    await agentButton.click();
    expect(agentRevoked).toBe(true);
  });

  test('detail has no horizontal overflow at mobile width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/settings/connected-agents/${INSTALLATION_ID}`);
    await expect(page.getByTestId('connected-agent-detail')).toBeVisible();
    expect(await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  });
});
