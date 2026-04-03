---
name: commit-push
description: Run quality gates, evaluate PR-level architectural compliance, commit, and push. Loops until everything passes before pushing. Called by run-plan at completion.
user-invocable: true
allowed-tools: Read Write Edit Grep Glob Bash Agent
---

# Commit Push

The effort directory is `docs/efforts/current/`. The plan is at `docs/efforts/current/plan.md`, the PRD at `docs/efforts/current/prd.md`, and the intention at `docs/efforts/current/intention.md`.

## Process

### 1. Read Context
- Read the `plan.md` in the effort directory to understand what was built
- Read the `prd.md` to understand what should have been built
- Read the `intention.md` to understand the original goals
- Identify the current branch name

### 2. Quick Gate Check
Run all quality gates one more time as a final safety net. These should already pass from run-plan, but verify:
- **Lint**: Run lint across the full project
- **Build**: Full project build
- **Unit Tests**: All tests pass
- **E2E Tests**: All e2e tests pass
- **Curl Tests**: Hit key API endpoints
- **Chrome Tests**: If applicable

If any fail, fix them before proceeding.

### 3. PR Evaluation
This is the architectural and code quality review. Evaluate the entire diff (`git diff main...HEAD`) against these criteria:

#### Code Quality
- No dead code, unused imports, or commented-out blocks
- Consistent naming conventions throughout
- No hardcoded secrets, credentials, or API keys
- Error handling is appropriate (not excessive, not missing)
- No obvious performance issues (N+1 queries, unbounded loops, memory leaks)

#### Architectural Compliance
- Code follows the patterns established in the codebase (NestJS conventions, Vue/Ionic patterns, etc.)
- New files are in the correct directories
- Database changes have proper migrations
- API endpoints follow existing conventions (routes, DTOs, guards)
- A2A protocol compliance where applicable
- Auth middleware applied correctly to new endpoints

#### PRD Compliance
- Every requirement in the PRD is addressed in the code
- No scope creep — nothing built that wasn't in the PRD
- Success criteria from the PRD are met

#### Test Coverage
- New code has corresponding tests
- Tests are meaningful (not just "it exists" tests)
- Edge cases covered where appropriate

### 4. Issue Resolution Loop
If the PR evaluation finds issues:
1. Collect all issues with severity and location
2. Fix them in the code
3. Re-run the affected gate checks
4. Re-run the PR evaluation
5. Repeat until clean

### 5. Commit and Push
Once everything passes:
1. Stage all changes: `git add` the relevant files (not blanket `git add .` — be deliberate)
2. Create a commit with a clear message summarizing the effort:
   ```
   [effort-name]: Summary of what was built
   
   - Phase 1: what it did
   - Phase 2: what it did
   - ...
   
   PRD: path/to/prd.md
   Plan: path/to/plan.md
   ```
3. Push the branch to origin: `git push -u origin [branch-name]`

### 6. Create PR
Create a pull request using `gh pr create`:
- **Title**: Short description of the effort
- **Body**: Include:
  - Summary of all phases completed
  - Link to PRD and plan
  - PR evaluation results (the passing evaluation)
  - Note that this is ready for `pr-eval` review

## Rules
- **Never push code that fails gates.** Fix first, always.
- **Never push secrets or credentials.**
- **The PR evaluation is not optional.** It must pass before pushing.
- **Be deliberate about what gets staged.** Review the diff before committing.
