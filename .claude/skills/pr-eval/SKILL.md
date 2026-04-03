---
name: pr-eval
description: Evaluate the current effort's PR for architectural compliance, code quality, and PRD alignment. Run this in the morning to review overnight work before merging to main. Optionally pass a PR number or branch name; otherwise finds the PR for the current branch.
user-invocable: true
allowed-tools: Read Write Edit Grep Glob Bash Agent
---

# PR Evaluation

Evaluate the pull request for the current effort.

If `$ARGUMENTS` is provided (PR number or branch name), use that. Otherwise, find the PR for the current branch. Read effort context from `docs/efforts/current/` (intention.md, prd.md, plan.md, completion-report.md).

## Process

### 1. Gather Context
- Get the PR details: `gh pr view [number]`
- Get the full diff: `gh pr diff [number]`
- Read the effort directory referenced in the PR body (PRD, plan, intention, completion report)
- Check CI/gate status if available

### 2. Full Evaluation
Run a thorough review of the PR against all criteria:

#### Intention Traceability
- Walk the intention file: is every goal addressed in the code changes?
- Walk the PRD: is every requirement implemented?
- Is there code in the diff that doesn't trace back to the intention or PRD?

#### Architectural Review
- Does the code follow established patterns in the codebase?
- Are NestJS conventions followed (modules, controllers, services, guards)?
- Are Vue/Ionic patterns followed (components, composables, stores)?
- Is the A2A protocol implementation correct?
- Are database changes clean (proper schema, no orphaned tables)?
- Is auth applied correctly everywhere it should be?
- Are new endpoints properly guarded?

#### Code Quality
- Clean code: no dead code, no commented-out blocks, no unused imports
- Consistent naming throughout
- No hardcoded values that should be config
- No secrets or credentials
- Appropriate error handling
- No performance red flags

#### Test Quality
- Adequate test coverage for new code
- Tests are meaningful and test real behavior
- Edge cases covered
- All tests passing

#### Security
- No injection vulnerabilities (SQL, command, XSS)
- Auth/authz properly enforced
- Input validation at system boundaries
- No sensitive data exposure

### 3. Report
Present the evaluation to the user:

```
## PR Evaluation: [PR Title]

### Status: [PASS | ISSUES FOUND]

### Scores
- Intention Alignment: [Pass/Fail] — [brief note]
- PRD Compliance: [Pass/Fail] — [brief note]
- Architecture: [Pass/Fail] — [brief note]
- Code Quality: [Pass/Fail] — [brief note]
- Test Coverage: [Pass/Fail] — [brief note]
- Security: [Pass/Fail] — [brief note]

### Issues (if any)
1. [Issue description, file, severity]
2. ...

### Strengths
- [What was done well]

### Recommendation
[Merge / Fix issues first]
```

### 4. Ask to Merge
After presenting the evaluation:
- If PASS: Ask the user "Ready to merge to main?"
- If ISSUES FOUND: Offer to fix the issues, then re-evaluate

### 5. Merge
If the user approves:
1. `git checkout main`
2. `git merge [branch-name]`
3. `git push origin main`
4. Report: "Merged [branch] into main and pushed."

### 6. Archive Effort
After successful merge:
1. Determine the effort name from the intention.md title or branch name
2. Move `docs/efforts/current/` to `docs/efforts/[effort-name]/` (e.g., `docs/efforts/move-to-spark/`)
3. Commit the move: `git add . && git commit -m "Archive effort: [effort-name]"`
4. Push: `git push origin main`
5. Report: "Effort archived to docs/efforts/[effort-name]/. Ready for a new effort in docs/efforts/current/."

## Growth Over Time
This evaluation will grow as the project matures. New criteria should be added as new architectural patterns, conventions, or compliance requirements are established. The evaluation is a living checklist that reflects what we care about for this codebase right now.
