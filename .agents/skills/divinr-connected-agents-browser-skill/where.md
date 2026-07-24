# Where — Connected-agent locators

## Device review

```ts
page.locator('[data-testid="device-connection-view"]')
page.locator('[data-testid="device-user-code"]')
page.locator('[data-testid="device-review"]')
page.locator('[data-testid="device-confirmation"]')
page.locator('[data-testid="device-approve"]')
page.locator('[data-testid="device-deny"]')
```

Use role locators for immutable content:

```ts
page.getByRole('heading', { name: 'Connect Apple Assistant', level: 1 })
page.getByRole('heading', { name: 'Installation', level: 2 })
page.getByRole('heading', { name: 'Requested access', level: 2 })
page.getByRole('heading', { name: 'Demo payment authority', level: 2 })
```

## List and detail

```ts
page.locator('[data-testid="connected-agents-list"]')
page.locator(`[data-testid="connected-agent-${installationId}"]`)
page.locator('[data-testid="connected-agent-detail"]')
page.locator(`[data-testid="connected-agent-grant-${grantId}"]`)
page.locator(`[data-testid="grant-revoke-confirmation-${grantId}"]`)
page.locator(`[data-testid="grant-revoke-${grantId}"]`)
page.locator('[data-testid="agent-revoke-reason"]')
page.locator('[data-testid="agent-revoke-confirmation"]')
page.locator('[data-testid="agent-revoke"]')
```

## Login return

For an unauthenticated context, open `/connect/device?user_code=ABCD-EFGH`,
click `[data-testid="device-sign-in"]`, then assert that the login URL contains
the encoded original path in its `redirect` query.
