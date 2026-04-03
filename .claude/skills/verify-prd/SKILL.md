---
name: verify-prd
description: Verify the current effort's PRD for completeness, consistency, and alignment with its intention. Iteratively fixes issues until the PRD passes. Called automatically by build-prd, or standalone.
user-invocable: true
allowed-tools: Read Write Edit Grep Glob Bash Agent
---

# Verify PRD

## Setup

1. **Read the PRD file** at `docs/efforts/current/prd.md`.
2. **Read the intention file** at `docs/efforts/current/intention.md`.
3. **Read the current codebase** enough to validate technical claims in the PRD.

## Verification Pass

Review the PRD through these lenses. You are thorough but not contrarian — you're looking for real gaps, not inventing problems.

### 1. Intention Traceability
- Walk through the intention file line by line. Every goal, constraint, principle, and requirement in the intention MUST have a corresponding section in the PRD. If something in the intention is not addressed, that is a **Critical** issue.
- Does the PRD introduce anything not traceable back to the intention? If so, that is scope creep unless it's necessary scaffolding — flag it either way.
- Are the phases in the PRD consistent with the sequencing described in the intention?

### 2. Completeness
- Are there requirements that are mentioned but not fleshed out?
- Are there phases that lack enough detail to implement?
- Are success criteria measurable and specific?
- Are all user stories covered by technical requirements?
- Are dependencies between phases explicitly stated?
- Does every API change specify endpoints, methods, request/response shapes?
- Does every data model change specify the actual schema changes?

### 3. Consistency
- Do the phases reference the same components/names consistently?
- Are there contradictions between sections?
- Do the technical requirements match the architecture description?
- Do the non-functional requirements align with the infrastructure described?

### 4. Architectural Soundness
- Is the proposed architecture grounded in what actually exists in the codebase?
- Are there technical claims that don't match the code?
- Are there missing infrastructure concerns (ports, networking, process management)?
- Is the phasing order correct — does each phase have its prerequisites met by earlier phases?

### 5. Risks and Gaps
- Are the identified risks real? Are there obvious risks missing?
- Are mitigation strategies actionable or just hand-waving?
- Are there implicit assumptions that should be explicit?

## Issue Collection

After the verification pass, compile a list of issues. For each issue:
- **Section**: Which PRD section it's in
- **Severity**: Critical (blocks implementation), Major (causes confusion), Minor (polish)
- **Issue**: What's wrong
- **Fix**: What the corrected content should be

## Edit Pass

Now fix every issue directly in your working copy of the PRD content (in memory, not on disk yet):
- Apply all fixes
- Ensure fixes don't introduce new inconsistencies
- Maintain the PRD's overall structure and voice

## Re-Verify

Run the verification pass again on the edited content. If new issues are found:
- Collect them
- Fix them
- Re-verify again

**Repeat until a verification pass finds zero Critical or Major issues.** Minor issues should also be fixed but don't block completion.

## Finalize

Once the PRD passes verification:
1. **Write the final PRD** back to the original file path
2. **Report to the user**:
   - How many iterations it took
   - Summary of the most significant issues found and fixed
   - Any Minor items that were addressed
   - Confirmation that the PRD now aligns with the intention

## Tone

You are a thorough technical reviewer, not a critic. Your goal is to make the PRD as strong as possible. If something in the PRD is good, don't touch it. If something is genuinely missing or wrong, fix it clearly. Don't add fluff, don't over-engineer the document, and don't introduce requirements that aren't grounded in the intention or the codebase.
