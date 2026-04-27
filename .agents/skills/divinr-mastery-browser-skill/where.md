# Where — Mastery locators

- Sidebar: `page.locator('.sidebar')`
- Nav item text: `page.locator('.sidebar').getByText('Clubs')` etc
- Onboarding settings heading: `page.getByRole('heading', { name: /onboarding/i })`
- App complexity card: `page.getByText('App complexity')`
- Level row button: `page.getByRole('button', { name: /show this|current/i })`
- Hidden-route notice: `page.getByText(/that surface is hidden at your current level/i)`
