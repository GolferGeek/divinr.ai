---
name: verify-plan
description: Verify the current effort's plan for completeness, consistency, and alignment with its PRD and intention. Iteratively fixes issues until the plan passes. Called automatically by build-plan, or standalone.
user-invocable: true
allowed-tools: Read Write Edit Grep Glob Bash Agent
---

# Verify Plan

## Setup

1. **Read the plan file** at `docs/efforts/current/plan.md`.
2. **Read the PRD** at `docs/efforts/current/prd.md`.
3. **Read the intention file** at `docs/efforts/current/intention.md`.
4. **Read the current codebase** enough to validate technical claims and commands in the plan.

## Verification Pass

Review the plan through these lenses. Thorough but not contrarian — looking for real gaps.

### 1. PRD + Intention Traceability
- Walk through the PRD section by section. Every requirement, phase, and success criterion in the PRD MUST have corresponding steps in the plan. If something from the PRD is not addressed, that is a **Critical** issue.
- Then walk through the intention file. Every goal, constraint, and principle in the intention must be traceable through the PRD and into the plan. If something from the intention is missing from the plan, that is a **Critical** issue.
- Does the plan introduce work not traceable to the PRD or intention? If so, that is scope creep unless it's necessary scaffolding — flag it either way.
- Is the phase ordering consistent with the PRD's phasing?

### 2. Completeness
- Does every phase have concrete, checkable steps?
- Are steps specific enough to implement without guessing?
- Does every phase have a complete quality gate (lint, build, unit tests, e2e, curl, chrome, phase review)?
- Are the test commands real and runnable? Do they reference actual test frameworks and configs in the codebase?
- Are curl test commands complete with URLs, methods, headers, and expected responses?
- Are chrome test scenarios specific enough to verify?
- Are dependencies between phases explicit?

### 3. Consistency
- Are component names, file paths, and service names consistent throughout?
- Do step references match actual codebase structure?
- Are port numbers, URLs, and config values consistent?
- Do quality gate commands match what's specified in earlier setup steps?

### 4. Executability
- Can each step actually be performed in sequence?
- Are there missing prerequisite steps?
- Are there steps that are too vague ("set up the database" vs "run `psql -f backup.sql` against the prediction schema")?
- Would run-plan be able to execute this without stopping to ask clarifying questions?
- Is the progress tracker complete and matching all phases?

### 5. Gate Quality
- Are the quality gates meaningful? Would they actually catch regressions?
- Are there phases where certain gate items don't apply but are still listed (or vice versa)?
- Is the phase review criteria specific to what that phase actually builds?

## Issue Collection

For each issue found:
- **Section**: Which plan section
- **Severity**: Critical (blocks execution), Major (causes confusion or missed work), Minor (polish)
- **Issue**: What's wrong
- **Fix**: What the corrected content should be

## Edit Pass

Fix all issues in the plan content (in memory, not on disk):
- Apply all fixes
- Ensure fixes don't introduce new inconsistencies
- Maintain the plan's structure

## Re-Verify

Run verification again on the edited content. If new issues found, fix and re-verify. Repeat until zero Critical or Major issues.

## Finalize

Once the plan passes:
1. **Write the final plan** back to the original file path
2. **Report to the user**:
   - How many iterations it took
   - Summary of most significant issues found and fixed
   - Confirmation that the plan aligns with the PRD and intention
   - The plan is ready for run-plan

## Tone

Thorough technical reviewer focused on executability. The key question is: "Could run-plan execute this plan start to finish without getting stuck?" If yes, it passes. If not, fix what would cause it to stall.
