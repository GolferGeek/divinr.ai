# Divinr.ai Demo Script

Use this script for contract, diligence, funding, or collaborator walkthroughs. It is written as a practical checklist rather than a sales deck.

## Before the Call

1. Install dependencies.

   ```bash
   pnpm install
   ```

2. Create local environment configuration.

   ```bash
   cp .env.example .env
   ```

3. Start the database.

   ```bash
   docker compose up -d
   ```

4. Build the workspace.

   ```bash
   pnpm -w run build
   ```

5. Bootstrap schema and start the API.

   ```bash
   pnpm --filter @divinr/api run dev:up
   ```

6. Start the web app in a second terminal.

   ```bash
   pnpm --filter @divinr/web run dev
   ```

7. Open `http://localhost:7101`.

## Suggested Walkthrough

### 1. Product Frame

Start with the trust boundary:

- Divinr.ai is for analysis, education, and simulated practice.
- It is not a prediction model and not investment advice.
- Paper trading is used throughout; no real securities are bought or sold.

### 2. Dashboard

Show the main dashboard as the first product surface:

- Current portfolio and relevant signals.
- Visible rationale for why analysis is surfaced.
- First-touch onboarding behavior if it appears.

### 3. Analysis Detail

Open a recent analysis:

- Show analyst rationale.
- Show cited or contributing articles.
- Show conviction and evidence.
- Explain that outcomes and calibration are tracked after the fact.

### 4. Paper Trade Intent

Use the signal-to-trade flow:

- Open the pre-filled paper-trade ticket.
- Emphasize simulated execution and learning use.
- Show how position state connects back to analyst signal.

### 5. Tournaments

Open tournaments:

- Show leaderboard, rank deltas, and entrant context.
- Show my positions and trade surface.
- Explain how this supports no-real-money learning and classroom/club use.

### 6. Clubs and Social Learning

Open clubs:

- Show activity, members, mentoring, curriculum, or club analytics.
- Explain the classroom and student-club path.
- Show how social workflows remain connected to paper-trading practice.

### 7. Authoring and Power Users

Open the authoring surfaces if the audience is technical:

- Analyst contract editor.
- Custom instruments.
- Triple-slot enablement.
- BYO model credentials.
- Cost attribution.

### 8. Operator View

For technical or operational reviewers:

- Show LLM usage and cost dashboards.
- Show billing tools only if relevant.
- Show audit findings, calibration, or attribution surfaces.

## Good Reviewer Questions to Invite

- How does the product prevent real-trading confusion?
- How are analyst outputs evaluated after the fact?
- What happens when optional API keys are absent?
- How does tenant or organization scoping work?
- Which workflows are covered by Playwright or compliance tests?
- What would need to change before a live billing or production deployment?

## After the Call

Point reviewers to:

- [README.md](../README.md)
- [docs/features.md](features.md)
- [docs/technical-overview.md](technical-overview.md)
- [docs/roadmap.md](roadmap.md)
- [SECURITY.md](../SECURITY.md)
