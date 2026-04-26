---
name: build-prd
description: Build a PRD from the current effort's intention file. Finds the effort folder inside docs/efforts/current/, writes prd.md, verifies, then flows into build-plan.
user-invocable: true
allowed-tools: Read Write Edit Grep Glob Bash Agent
---

# Build PRD from Intention

Discover the current effort by finding the single subfolder inside `docs/efforts/current/` (e.g., `docs/efforts/current/multi-analyst-coordination/`). Read the intention file at `<effort-dir>/intention.md`. All effort documents (prd.md, plan.md, completion-report.md) will be written to that same effort directory.

## Process

1. **Read the intention file** thoroughly. Understand the goals, constraints, technical context, and desired outcomes.

2. **Research the current codebase** to understand existing architecture, tech stack, and patterns already in place. This grounds the PRD in reality rather than assumptions.

3. **Build the PRD** with the following structure:

### PRD Structure

```markdown
# [Project/Effort Name] — Product Requirements Document

## 1. Overview
Brief summary of what this effort accomplishes and why it matters.

## 2. Goals & Success Criteria
- Concrete, measurable goals
- How we know this effort is done and successful

## 3. User Stories / Use Cases
Who benefits and how. Be specific.

## 4. Technical Requirements
### 4.1 Architecture
### 4.2 Data Model Changes
### 4.3 API Changes
### 4.4 Frontend Changes
### 4.5 Infrastructure Requirements

## 5. Non-Functional Requirements
- Performance targets
- Security considerations
- Scalability expectations
- Compatibility requirements

## 6. Out of Scope
Explicitly state what this effort does NOT include.

## 7. Dependencies & Risks
- External dependencies
- Technical risks
- Mitigation strategies

## 8. Phasing
Break the work into logical phases that can each be independently validated.
Each phase should be a meaningful increment — not just a task list.
```

4. **Write the PRD** to a `prd.md` file in the same directory as the intention file.

5. **Verify the PRD** — run the verify-prd process (below) before presenting to the user. The PRD is not done until verification passes.

## Verification Loop

After writing the initial PRD, run this loop:

### Verify
Review the PRD against the intention file and codebase for:
- **Intention traceability**: Walk through the intention file line by line. Every goal, constraint, principle, and requirement in the intention MUST have a corresponding section in the PRD. If something in the intention is not addressed, that is a Critical issue. No scope creep — nothing in the PRD that isn't traceable back to the intention.
- **Completeness**: All requirements fleshed out. Success criteria measurable. API changes specify endpoints/methods/shapes. Data model changes specify schema.
- **Consistency**: Same names/components throughout. No contradictions between sections. Technical requirements match architecture.
- **Architectural soundness**: Claims grounded in actual codebase. Phase ordering correct. No missing infrastructure concerns.
- **Risks**: Real risks identified with actionable mitigations. No implicit assumptions left unstated.

### Collect Issues
For each issue: section, severity (Critical/Major/Minor), what's wrong, what the fix is.

### Fix
Apply all fixes in memory. Ensure fixes don't introduce new problems.

### Re-Verify
Run verification again. Repeat until zero Critical or Major issues.

### Exit the Loop
Only exit when a verification pass produces no Critical or Major issues. Write the final PRD to disk.

## Finalize

Once verification passes:
1. **Write the final PRD** to the file
2. **Report to the user**: iterations taken, significant issues found and fixed, confirmation of intention alignment
3. **Immediately proceed to build-plan**: Pass the PRD file path to the build-plan process. Do not wait for user confirmation — the verified PRD flows straight into plan building.

## Guidelines

- Be specific and technical — this PRD will feed directly into an implementation plan
- Ground everything in the actual codebase, not assumptions
- Each phase in section 8 should be small enough to validate but large enough to be meaningful
- Include enough detail that a developer unfamiliar with the project could understand what to build
- Do not pad with generic boilerplate — every line should carry information
