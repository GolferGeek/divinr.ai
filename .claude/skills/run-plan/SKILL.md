---
name: run-plan
description: Execute the current effort's plan phase by phase, respecting quality gates and tracking progress. Creates a branch, runs all phases, then commit-push and notify.
user-invocable: true
allowed-tools: Read Write Edit Grep Glob Bash Agent mcp__claude_ai_Gmail__gmail_create_draft mcp__claude_ai_Gmail__gmail_get_profile
---

# Run Implementation Plan

Discover the current effort by finding the single subfolder inside `docs/efforts/current/` (e.g., `docs/efforts/current/multi-analyst-coordination/`). Read the plan at `<effort-dir>/plan.md`. The PRD is at `<effort-dir>/prd.md`. The intention is at `<effort-dir>/intention.md`. The completion report will be written to `<effort-dir>/completion-report.md`.

## Startup

1. **Read the plan file** and the referenced PRD file.
2. **Create a feature branch** from main: `git checkout -b effort/[effort-name-slug]` (e.g., `effort/move-to-spark`). If the branch already exists (resuming), check it out.
3. **Check the Progress Tracker** to find where we left off. Look for the first unchecked phase.
4. **Report status** to the user:
   - Current branch
   - Which phases are done
   - Which phase we're about to start
   - What that phase involves
5. **Proceed immediately** — this pipeline is autonomous.

## Execution Loop (per phase)

### Step 1: Implement
- Work through each step in the current phase sequentially
- After completing each step, **update the plan file** by checking off the step: `- [ ]` becomes `- [x]`
- Save the plan file after each step so progress is never lost
- If a step is unclear or blocked, stop and ask the user

### Step 2: Quality Gate
Once all steps are checked off, run every item in the Quality Gate:

1. **Lint**: Run the specified lint command. Fix any issues before proceeding.
2. **Build**: Run the specified build command. Fix any errors.
3. **Unit Tests**: Run unit tests. All must pass — both new tests written in this phase and all pre-existing tests.
4. **E2E Tests**: Run e2e tests if specified. All must pass.
5. **Curl Tests**: Execute each curl command listed. Verify expected responses.
6. **Chrome Tests**: If specified, describe what to verify in the browser and confirm with the user.
7. **Phase Review**:
   - Re-read the PRD section for this phase
   - Compare what we actually built against what the PRD specified
   - Check off each review item in the plan
   - If there are deviations, document them in the plan file as a note under the phase

**Update each gate item** in the plan file as it passes: `- [ ]` becomes `- [x]`

### Step 3: Gate Decision
- **If all gate items pass**: Mark the phase as complete in the Progress Tracker, update the phase status to `Complete`, and report to the user.
- **If any gate item fails**: Stop. Report what failed, why, and what needs to be fixed. Fix the issues and re-run the failed gate items. Do not proceed to the next phase until everything passes.

### Step 4: Phase Transition
- Tell the user the phase is complete and summarize what was accomplished
- Show the updated Progress Tracker
- **If all gates passed, proceed immediately to the next phase** — no need to wait for confirmation
- Only stop if a gate failed or if something needs a user decision

## Progress Tracking

The plan file IS the source of truth. Keep it updated in real-time:
- Check off steps as they're completed
- Check off gate items as they pass
- Update phase statuses (Not Started → In Progress → Complete)
- Add notes for any deviations or decisions made during implementation

If the conversation is interrupted and resumed later, re-read the plan file to pick up exactly where we left off.

## Rules

- **Never skip a quality gate.** If tests don't exist yet, write them.
- **Auto-advance when all gates pass.** Only stop if a gate fails or a decision is needed.
- **Always update the plan file** as work progresses. If we crash or context-switch, the plan file should accurately reflect what's done.
- **If something in the plan doesn't make sense** given what you see in the code, raise it with the user rather than silently deviating.
- **Keep the user informed** at natural milestones — don't go silent for long stretches.

## Completion Notification

When all phases are complete (or if the pipeline stops due to an unresolvable gate failure):

### 1. Write Completion Report
Write a `completion-report.md` file in the same directory as the plan with:

```markdown
# [Effort Name] — Completion Report

**Plan**: [relative path to plan.md]
**PRD**: [relative path to prd.md]
**Completed**: [date and time]
**Final Status**: [All Phases Complete | Stopped at Phase N]

## Summary
- Total phases: N
- Phases completed: N
- Phases remaining: N

## Phase Results
For each phase:
- Phase name
- Status (Complete / Failed)
- Notable decisions or deviations
- Any issues encountered and how they were resolved

## Gate Results
Summary of all quality gates — which passed clean, which required fixes.

## Deviations from PRD
List any places where the implementation differs from the PRD and why.

## Next Steps
If stopped early: what needs to happen to continue.
If complete: any follow-up work identified during implementation.
```

### 2. Commit and Push
Run the commit-push process:
- Run all quality gates one final time
- Run the PR evaluation (architectural compliance, code quality, PRD compliance)
- If issues found, fix and re-evaluate until clean
- Commit all changes with a clear summary
- Push the branch and create a PR
- The PR is ready for the user to run `/pr-eval` in the morning

### 3. Send Email Notification
Use Gmail to send an email to the user's own address with:
- **Subject**: `Divinr AI: [Effort Name] — [Complete | Stopped at Phase N]`
- **Body**: A concise version of the completion report — status, phases completed, any issues, the PR URL, and a note to run `/pr-eval` to review and merge.

Use `gmail_get_profile` to get the user's email address, then `gmail_create_draft` to create and send the notification.
