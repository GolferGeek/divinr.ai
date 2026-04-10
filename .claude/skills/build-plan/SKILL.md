---
name: build-plan
description: Build a gated implementation plan from the current effort's PRD. Each phase includes quality gates with linting, tests, and PRD compliance checks.
user-invocable: true
allowed-tools: Read Write Edit Grep Glob Bash Agent
---

# Build Implementation Plan from PRD

Discover the current effort by finding the single subfolder inside `docs/efforts/current/` (e.g., `docs/efforts/current/multi-analyst-coordination/`). Read the PRD at `<effort-dir>/prd.md`. The intention is at `<effort-dir>/intention.md`. Write the plan to `<effort-dir>/plan.md`.

## Process

1. **Read the PRD** thoroughly. Understand every requirement, phase, and constraint.

2. **Analyze the current codebase** to understand:
   - Existing test infrastructure (test runners, frameworks, patterns)
   - Lint/build configuration
   - CI/CD setup if any
   - Current project structure and conventions

3. **Build the plan** using the structure below.

## Plan Structure

Write a `plan.md` file in the same directory as the PRD with this format:

```markdown
# [Effort Name] — Implementation Plan

**PRD**: [relative path to prd.md]
**Created**: [date]
**Status**: Not Started

## Progress Tracker
<!-- run-plan uses this section to track where we are -->
- [ ] Phase 1: [name]
- [ ] Phase 2: [name]
- [ ] Phase N: [name]

---

## Phase 1: [Phase Name]
**Status**: Not Started
**Objective**: [What this phase accomplishes — one sentence]

### Steps
- [ ] 1.1 [Specific implementation step]
- [ ] 1.2 [Specific implementation step]
- [ ] 1.3 [Specific implementation step]

### Quality Gate
Before moving to Phase 2, ALL of the following must pass:

- [ ] **Lint**: Code passes all lint rules (`[specific lint command]`)
- [ ] **Build**: Project builds without errors (`[specific build command]`)
- [ ] **Unit Tests**: All new and existing unit tests pass (`[specific test command]`)
- [ ] **E2E Tests**: End-to-end tests pass for affected flows (`[specific e2e command]`)
- [ ] **Curl Tests**: API endpoints respond correctly (list specific curl commands)
- [ ] **Chrome Tests**: UI renders and functions correctly (if applicable — list specific scenarios)
- [ ] **Phase Review**: Compare implementation against Phase 1 objectives in the PRD
  - [ ] Did we accomplish what we said we would?
  - [ ] Does the code align with the PRD requirements?
  - [ ] Are there any deviations? If so, document why.

---

## Phase 2: [Phase Name]
[Same structure as Phase 1]

---
```

## Guidelines

- **Every phase gets a quality gate.** No exceptions. The gate is not optional.
- **Steps must be checkable.** Each step is a concrete action that can be marked done.
- **Test commands must be real.** Look at the codebase to determine actual lint, build, and test commands. If they don't exist yet, include a step to set them up in Phase 1.
- **Curl tests**: For any API work, write the actual curl commands that should succeed after the phase.
- **Chrome tests**: For any UI work, describe the specific browser scenarios to verify.
- **Phase review is mandatory.** At the end of each phase, we explicitly compare what we built against what the PRD said we would build.
- **Keep phases small enough to gate meaningfully.** A phase that takes a week to complete before you can validate is too big.
- **Order phases so each builds on the last.** Earlier phases should establish foundations (project structure, test infrastructure, core models) before later phases add features.

## Verification Loop

After writing the initial plan, run this loop before presenting to the user. The plan is not done until verification passes.

### Verify
Review the plan against the PRD, intention, and codebase for:
- **PRD + Intention traceability**: Walk through the PRD section by section — every requirement, phase, and success criterion in the PRD MUST have corresponding steps in the plan. Then walk through the intention file — every goal, constraint, and principle in the intention must be traceable through the PRD and into the plan. If something from either document is not addressed in the plan, that is a Critical issue. No scope creep.
- **Completeness**: Every phase has concrete checkable steps. Every phase has a full quality gate (lint, build, unit tests, e2e, curl, chrome, phase review). Test commands are real and runnable. Curl commands are complete with URLs/methods/headers/expected responses.
- **Consistency**: Component names, file paths, service names consistent throughout. Port numbers, URLs, config values consistent. Gate commands match setup steps.
- **Executability**: Steps can be performed in sequence. No missing prerequisites. No vague steps. run-plan could execute without stopping to ask clarifying questions. Progress tracker matches all phases.
- **Gate quality**: Gates are meaningful and would catch regressions. Gate items appropriate per phase. Phase review criteria specific to what that phase builds.

### Collect Issues
For each issue: section, severity (Critical/Major/Minor), what's wrong, what the fix is.

### Fix
Apply all fixes in memory. Ensure fixes don't introduce new problems.

### Re-Verify
Run verification again. Repeat until zero Critical or Major issues.

### Exit the Loop
Only exit when a verification pass produces no Critical or Major issues. Write the final plan to disk.

## Finalize

Once verification passes:
1. **Write the final plan** to the file
2. **Report to the user**: iterations taken, significant issues found and fixed, confirmation of PRD alignment
3. **Immediately proceed to run-plan**: Execute the verified plan. Do not wait for user confirmation — the pipeline is autonomous.
