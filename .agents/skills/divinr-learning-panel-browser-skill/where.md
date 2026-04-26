# Where — Learning Panel locators

- Route heading: `page.getByRole('heading', { name: /learning panel/i })`
- Composer: `page.locator('textarea').first()`
- Send button: `page.getByRole('button', { name: /send/i })`
- Message body container: `page.locator('body')`
- Grounding label: `page.getByText('Grounded in')`
- First-touch panel: `page.locator('[surface-key=\"chat\"], [data-surface-key=\"chat\"]')`

Use `document.body.innerText` for persisted-thread assertions because the view does not expose stable message test ids yet.
