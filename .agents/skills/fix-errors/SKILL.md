---
name: fix-errors
description: "Fix quality issues found by scan-errors. Spawns parallel worker agents to fix build errors, lint violations, and test failures across products."
user-invocable: true
allowed-tools: Read Write Edit Grep Glob Bash Agent
argument-hint: "[product] [--type TYPE] [--priority PRIORITY] [--workers N]"
---

# /fix-errors Command

## Purpose

Fix quality issues found by `/scan-errors`. Spawns parallel worker agents that simultaneously fix build errors, lint violations, and test failures. Works directly from the scan output — no database required.

## Usage

```
/fix-errors [product] [--type TYPE] [--priority PRIORITY] [--workers N]
```

**Arguments:**
- `product` (optional): Which product to fix
  - `forge/api`, `forge/web`, `compose/api`, `compose/web`
  - `auth/api`, `admin/web`
  - `ambient/pulse`, `ambient/bridge`, `command/web`
  - `all` - All products (default)

- `--type TYPE` (optional): Which error types to fix
  - `build` - Only TypeScript build errors
  - `lint` - Only ESLint lint errors
  - `test` - Only test failures
  - `all` - All error types (default)

- `--priority PRIORITY` (optional): Minimum priority to fix
  - `critical` - Only critical priority issues
  - `high` - Critical and high priority
  - `medium` - Critical, high, and medium (default)
  - `low` - All priorities including low

- `--workers N` (optional): Number of parallel workers
  - Default: 3
  - Maximum: 5

## Examples

```
/fix-errors
# Fix all products, all types, medium+ priority, 3 workers

/fix-errors forge/api
# Fix Forge API issues only

/fix-errors --type lint
# Fix only lint errors across all products

/fix-errors --priority critical
# Fix only critical issues

/fix-errors compose/api --type lint --workers 4
# Fix lint errors in Compose API with 4 parallel workers
```

## Prerequisites

Run `/scan-errors` first to see what needs fixing. The fix-errors command works from the current state of the codebase — it runs the quality commands itself to discover what to fix.

## Workflow

### 1. Discover Issues

Run quality commands to get the current list of issues:

```bash
cd apps/{product} && npm run build 2>&1
cd apps/{product} && npm run lint 2>&1
cd apps/{product} && npm test 2>&1
```

Filter results by `--type` and `--priority` arguments.

### 2. Group Issues by File

Organize issues by file path so parallel workers can each own a set of files without overlap.

### 3. Spawn Worker Agents

Create N sub-agents (default 3), each assigned a distinct set of files.

### 4. Fix in Parallel

Each worker agent processes its assigned files:

```
For each file:
  1. Try auto-fix if applicable (ESLint --fix for lint errors)
  2. If auto-fix succeeds, verify with a re-run of lint/build
  3. If auto-fix fails or not applicable, do manual fix:
     - Read the file
     - Understand the error
     - Apply the correct fix
     - Re-run the check to verify
  4. Report result (fixed / needs manual review)
```

### 5. Progress Dashboard

During fixing, a live dashboard shows progress:

```
Quality Fix Progress
================================================================
Started: 10:00:00  Elapsed: 2m 15s

Overall: 15/52 files (29%)

Workers:
Worker #1  FIXING   apps/forge/api/src/agents/marketing.service.ts    4 done
Worker #2  FIXING   apps/compose/web/src/components/agent-chat.vue     3 done
Worker #3  FIXING   apps/compose/api/src/invoke/invoke.controller.ts   5 done

Recent Completions:
- apps/forge/api/src/controllers/agent.controller.ts: 5/5 fixed
- apps/compose/api/src/runners/rag.service.ts: 3/4 fixed (1 needs manual review)

Issues: 45/156 fixed (29%)
  Critical: 2/2 (100%)
  High: 15/23 (65%)
  Medium: 28/131 (21%)
```

### 6. Final Summary

After all workers complete:

```
Quality Fix Summary
================================================================
Duration: 12m 45s
Products Fixed: forge/api, compose/api
Workers Used: 3

Results by Product:
Product       Attempted  Fixed  Failed  Success
forge/api       120       105     15     87.5%
compose/api      25        22      3     88.0%
compose/api      11        10      1     90.9%

Results by Priority:
Priority   Attempted  Fixed  Failed  Success
Critical       2         2      0    100%
High          23        21      2     91.3%
Medium       131       114     17     87.0%

Issues Requiring Manual Review:
1. apps/forge/api/src/agents/risk.service.ts:45 — Complex type error, needs refactoring
2. apps/compose/web/src/views/RunnerView.vue:123 — Deprecated API usage

Verification: Re-ran build/lint/test — 0 new issues introduced
```

## How Issues Are Fixed

### Auto-Fixable Lint Errors
```bash
npx eslint --fix <file_path>
```
Works for: indent, semi, quotes, trailing-comma, no-extra-semi, etc.

### Manual Fixes
- **Unused variables**: Remove the variable or use it
- **Type errors**: Add or correct type annotations
- **Missing imports**: Add the required import
- **Deprecated APIs**: Update to current patterns

### Complex Issues (Manual Review Required)
Some issues require significant refactoring and are flagged for manual attention:
- Deep type system changes
- Major architectural refactoring
- Issues where the fix would break other code

## Best Practices

1. **Run scan first**: Use `/scan-errors` to understand the scope before fixing
2. **Fix critical first**: Use `--priority critical` for a quick first pass
3. **One product at a time**: Fix `forge/api` before moving to `compose/api` for cleaner verification
4. **Verify after**: Run `/scan-errors` again after fixing to confirm
5. **Commit after**: Use `/commit` to save the fixed state

## Related

- **`/scan-errors`** - Discover issues before fixing
- **`/monitor`** - Full codebase health analysis
- **`/test`** - Run tests after fixing
- **`/commit`** - Commit the fixes
