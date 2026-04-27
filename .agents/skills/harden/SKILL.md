---
name: harden
description: "Run codebase hardening on specific issues from monitoring report files. Auto-fixes issues if tests are adequate, otherwise documents issues with fix plans."
user-invocable: true
allowed-tools: Read Write Edit Grep Glob Bash Agent
argument-hint: "[scope] [target] - Scope: 'apps/forge', 'apps/compose', etc. Target: '#<issue-id>', '<refactoring-name>', or auto-identify most important (default)."
---

# /harden Command

## Purpose

Run codebase hardening on specific issues from monitoring report files. Reads from `.monitor/*.json` artifact files (written by `/monitor`). Auto-fixes issues if tests are adequate, otherwise documents the issue with a fix plan.

## Usage

```
/harden [scope] [target]
```

**Arguments:**
- `scope` (optional): Which monitoring artifact to use
  - `apps/forge` - Use `.monitor/apps-forge.json`
  - `apps/forge/api` - Use `.monitor/apps-forge-api.json`
  - `apps/forge/web` - Use `.monitor/apps-forge-web.json`
  - `apps/compose` - Use `.monitor/apps-compose.json`
  - `apps/compose/api` - Use `.monitor/apps-compose-api.json`
  - `apps/compose/web` - Use `.monitor/apps-compose-web.json`
  - `apps/auth` - Use `.monitor/apps-auth.json`
  - `apps/admin` - Use `.monitor/apps-admin.json`
  - `apps/ambient/pulse` - Use `.monitor/apps-ambient-pulse.json`
  - `apps/ambient/bridge` - Use `.monitor/apps-ambient-bridge.json`
  - `apps/command` - Use `.monitor/apps-command.json`
  - `project` - Use `.monitor/project.json`
  - (no scope) - Use `.monitor/all.json` (entire project)

- `target` (optional): Which issue or refactoring to fix
  - `#<issue-id>` - Fix specific issue by ID (e.g., `#42`)
  - `<refactoring-name>` - Target all issues for a refactoring (e.g., `a2a-endpoint-compliance`)
  - (no target) - Auto-identify the most important issue (default)

## Examples

```
/harden
# Use all.json, auto-identify most important issue

/harden apps/forge
# Use forge artifact, auto-identify most important issue

/harden apps/forge #1
# Fix issue #1 from forge artifact

/harden apps/forge a2a-endpoint-compliance
# Target all issues in 'a2a-endpoint-compliance' refactoring

/harden apps/compose/api execution-context-flow
# Fix all ExecutionContext flow issues in Compose API

/harden project
# Use project-level artifact, fix most important issue
```

## Workflow

### 1. Load Artifact from File

Read the monitoring artifact from `.monitor/*.json`:

```bash
cat .monitor/apps-forge.json
```

If the artifact does not exist:
```
No monitoring artifact found for scope 'apps/forge'.
Please run: /monitor apps/forge
```

### 2. Determine Target Issue(s)

**If issue ID provided (`#42`):**
- Find issue by `id` field in artifact
- Target that specific issue

**If refactoring name provided (`a2a-endpoint-compliance`):**
- Find all issues where `refactoring === 'a2a-endpoint-compliance'`
- Target those issues as a group

**If no target:**
- Find highest urgency + severity issue
- Target that issue

### 3. Call Hardening Agent

Invoke `codebase-hardening-agent` with:
- The monitoring artifact (from file)
- The targeted issue(s)

### 4. Agent Hardening

For each targeted issue, the agent:

1. **Reviews the issue** — Reads the file(s) involved
2. **Checks test adequacy:**
   - Unit tests exist for affected functions
   - Integration tests exist for affected services
   - Coverage thresholds met (>=75% lines, >=70% branches)
   - Tests are meaningful (not just stubs)

**If tests are adequate:**
- Auto-fixes the issue
- Runs tests to verify nothing broke
- Commits changes with a descriptive message

**If tests are inadequate:**
- Does NOT make code changes
- Documents the issue in `.monitor/issues/issue-{id}.md`
- Includes: problem description, proposed solution, required test coverage, implementation steps

### 5. Display Summary

**Auto-Fix Result:**
```
Hardening complete!

Target: Issue #2 - Marketing swarm missing A2A endpoint
File: apps/forge/api/src/agents/marketing-swarm.agent.ts
Test adequacy: Adequate (88% lines, 82% branches, 91% functions)

Actions taken:
  Auto-fixed: Added A2A endpoint and agent.json discovery
  Tests passed: All tests passing after fix
  Committed: feat(forge/api): add A2A endpoint for marketing swarm

Changes made:
  - Updated apps/forge/api/src/agents/marketing-swarm.agent.ts
  - Created apps/forge/api/src/agents/.well-known/agent.json
  - Updated apps/forge/api/src/app.module.ts
```

**Documentation Result:**
```
Hardening complete!

Target: Issue #1 - ExecutionContext not consistently passed
File: apps/forge/api/src/agents/legal-department.service.ts
Test adequacy: Inadequate (missing integration tests for context propagation)

Actions taken:
  Documented: Issue requires additional test coverage before auto-fix
  Created: .monitor/issues/issue-1.md

Issue documented with:
  - Problem: ExecutionContext created inline instead of received from store
  - Proposed solution: Refactor to pass context as parameter chain
  - Required tests: Integration tests for ExecutionContext propagation
  - Implementation steps: 4 steps outlined in issue file
```

## Test Adequacy Criteria

**Criteria for Auto-Fix:**
- Unit tests exist for all affected functions/methods
- Integration tests exist for affected services (where applicable)
- Coverage meets thresholds: >=75% lines, >=70% branches, >=75% functions
- Tests are meaningful (assert behavior, not just "it runs")

**When Tests are Inadequate:**
- Document the issue instead of fixing it
- This prevents introducing regressions without test coverage
- Run `/test generate` to create the needed tests first, then re-run `/harden`

## Issue Documentation Files

Issues documented without auto-fix are saved to:
```
.monitor/issues/issue-{id}.md
```

These files contain:
- Problem description and root cause
- Proposed solution with code examples
- Required test coverage (what tests to write first)
- Implementation steps (step-by-step guide)
- Risk assessment (what could break)

## Related

- **`codebase-hardening-agent.md`** - Performs the hardening
- **`/monitor`** - Generates the monitoring artifacts read by this command
- **`/test`** - Run or generate tests to meet adequacy criteria before hardening
