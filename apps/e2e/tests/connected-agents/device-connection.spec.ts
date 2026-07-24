import { expect, test, type Page } from '@playwright/test';

const REVIEW = {
  schemaVersion: 2,
  installationId: 'apple-installation-demo-001',
  installationName: 'Gary’s Mac Studio Assistant',
  dpopJkt: '4B8vbwS0f4M8Gv7gWQ_frozen_thumbprint_demo',
  scopes: ['commerce:purchase', 'receipts:read', 'updates:read'],
  resources: ['https://divinr.ai/a2a'],
  authority: {
    profileVersion: 2,
    mode: 'autonomous',
    network: 'regtest',
    economicValue: false,
    productPriceMinorUnits: { minimum: 1, maximum: 5 },
    maximumSuccessfulCalls: 10,
    maximumCumulativePriceMinorUnits: 25,
    maximumAtomicAmount: '250000',
    maximumPerTransactionAtomicAmount: '50000',
    authorityWindowSeconds: 3600,
  },
  expiresAt: '2099-07-24T18:00:00.000Z',
  status: 'pending',
};

function configuredAuth() {
  localStorage.setItem('divinr_user', '20000000-0000-0000-0000-000000000001');
  localStorage.setItem('divinr_token', 'browser-test-token');
  localStorage.setItem('divinr_role', 'member');
}

async function mockSharedApi(page: Page) {
  await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/first-touch/state') {
      await route.fulfill({ json: { muted: false, touched: [
        'settings.agent-device-connection',
        'settings.connected-agents',
        'settings.connected-agent-detail',
      ] } });
      return;
    }
    if (url.pathname.startsWith('/api/first-touch/')) {
      await route.fulfill({ json: { ok: true } });
      return;
    }
    await route.fulfill({ status: 200, json: {} });
  });
}

test.describe('device connection — login return', () => {
  test('preserves the complete device path through sign in', async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:7101',
      storageState: undefined,
    });
    const page = await context.newPage();
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({ status: 401, json: { message: 'Auto-login disabled for this case' } }));
    await page.goto('/connect/device?user_code=ABCD-EFGH');
    await page.getByTestId('device-sign-in').click();
    await expect(page).toHaveURL(/\/login\?redirect=/);
    const redirect = new URL(page.url()).searchParams.get('redirect');
    expect(redirect).toBe('/connect/device?user_code=ABCD-EFGH');
    await context.close();
  });
});

test.describe('device connection — typed owner action', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(configuredAuth);
    await mockSharedApi(page);
  });

  test('desktop review requires exact typed approval and renders frozen authority', async ({ page }) => {
    let approved = false;
    await page.route('**/api/connected-agents/device/**', async (route) => {
      if (route.request().method() === 'POST') {
        approved = route.request().url().endsWith('/approve');
        await route.fulfill({ json: { status: 'approved' } });
        return;
      }
      await route.fulfill({ json: REVIEW });
    });

    await page.goto('/connect/device?user_code=ABCD-EFGH');
    await expect(page.getByRole('heading', { name: 'Connect Apple Assistant', level: 1 })).toBeVisible();
    await expect(page.getByText(REVIEW.installationId)).toBeVisible();
    await expect(page.getByText(REVIEW.dpopJkt)).toBeVisible();
    await expect(page.getByText(/valueless bitcoin regtest only/i)).toBeVisible();
    await expect(page.getByText(/1–5¢ each/i)).toBeVisible();

    const approve = page.getByTestId('device-approve');
    await expect(approve.locator('button')).toBeDisabled();
    await page.getByTestId('device-confirmation').locator('input').fill('Approve');
    await expect(approve.locator('button')).toBeDisabled();
    await page.getByTestId('device-confirmation').locator('input').fill('APPROVE');
    await expect(approve.locator('button')).toBeEnabled();
    await approve.click();
    expect(approved).toBe(true);
    await expect(page.getByText(/apple assistant is approved/i)).toBeVisible();
  });

  test('mobile review fits and exact typed denial is independent of approval', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let denied = false;
    await page.route('**/api/connected-agents/device/**', async (route) => {
      if (route.request().method() === 'POST') {
        denied = route.request().url().endsWith('/deny');
        await route.fulfill({ json: { status: 'denied' } });
        return;
      }
      await route.fulfill({ json: REVIEW });
    });
    await page.goto('/connect/device?user_code=ABCD-EFGH');
    const deny = page.getByTestId('device-deny');
    await expect(deny.locator('button')).toBeDisabled();
    await page.getByTestId('device-confirmation').locator('input').fill('DENY');
    await expect(deny.locator('button')).toBeEnabled();
    await expect(page.getByTestId('device-approve').locator('button')).toBeDisabled();
    await deny.click();
    expect(denied).toBe(true);
    const overflows = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflows).toBe(false);
  });
});
