---
name: scan-errors
description: "Scan codebase for TypeScript build errors, ESLint lint errors, and test failures. Outputs structured results to console."
user-invocable: true
allowed-tools: Read Write Edit Grep Glob Bash Agent
argument-hint: "[product] [--type TYPE] - Product: forge/api, compose/web, flow/api, etc. Type: build, lint, test, all"
---

# /scan-errors

Scan the codebase for build errors, lint violations, and test failures. All results are printed to the console in a structured format. Run `/fix-errors` afterward to address the issues found.

## Usage

```
/scan-errors [product] [--type TYPE]
```

**Arguments:**
- `product` (optional): Which product to scan
  - `forge/api` - Forge API
  - `forge/web` - Forge Web
  - `compose/api` - Compose API
  - `compose/web` - Compose Web
  - `auth/api` - Auth API
  - `admin/web` - Admin Web
  - `flow/api` - Flow API
  - `flow/web` - Flow Web
  - `ambient/pulse` - Pulse
  - `ambient/bridge` - Bridge
  - `command/web` - Command Web
  - `all` - All products (default)

- `--type TYPE` (optional): Which error types to scan
  - `build` - TypeScript compilation errors only
  - `lint` - ESLint errors only
  - `test` - Test failures only
  - `all` - All error types (default)

## Examples

```
/scan-errors
# Scan all products, all error types

/scan-errors forge/api
# Scan Forge API only

/scan-errors --type lint
# Scan lint errors across all products

/scan-errors compose/web --type build
# Scan Compose Web for build errors only
```

## Workflow

### 1. Determine Scope

Based on the product argument, identify which `apps/` directories to scan.

### 2. Run Quality Commands

For each product in scope, run the appropriate commands:

**Build check:**
```bash
cd apps/{product} && npm run build 2>&1
```

**Lint check:**
```bash
cd apps/{product} && npm run lint 2>&1
```

**Test check:**
```bash
cd apps/{product} && npm test 2>&1
```

### 3. Parse Outputs

**Build errors** — parse TypeScript compiler output:
```
src/file.ts(10,5): error TS2345: Argument of type 'string' is not assignable...
```

**Lint errors** — parse ESLint output:
```
src/file.ts:10:5: error  no-unused-vars  'foo' is defined but never used
```

**Test failures** — parse Jest/Vitest output:
```
FAIL src/services/my.service.spec.ts
  MyService
    should do something
      Expected: true
      Received: false
```

### 4. Output Structured Results to Console

Print a formatted summary to console:

```
SCAN RESULTS
================================================================
Scanned: 2026-03-14T10:00:00Z
Products: forge/api, compose/api, flow/api

SUMMARY
----------------------------------------------------------------
Product         Build   Lint    Tests   Total
forge/api         0      23       2      25
compose/api       3       8       0      11
flow/api          0       5       1       6

TOTAL             3      36       3      42

DETAILS BY PRODUCT
================================================================

forge/api — 25 issues
----------------------------------------------------------------
LINT (23 issues):
  [HIGH]   apps/forge/api/src/agents/marketing.service.ts:45:10
           @typescript-eslint/no-explicit-any — Unexpected any. Specify a different type.

  [MEDIUM] apps/forge/api/src/agents/legal.controller.ts:12:3
           no-unused-vars — 'ctx' is defined but never used.

  ... (21 more lint issues)

TEST (2 failures):
  [HIGH]   apps/forge/api/src/agents/__tests__/marketing.service.spec.ts
           MarketingSwarm > should generate content
           Expected: { status: 'completed' }
           Received: { status: 'error', message: 'LLM timeout' }

compose/api — 11 issues
----------------------------------------------------------------
BUILD (3 errors):
  [CRITICAL] apps/compose/api/src/runners/rag.service.ts(22,8):
             error TS2345: Argument of type 'string' is not assignable to parameter of type 'ExecutionContext'

  ... (2 more build errors)

================================================================
NEXT STEPS
----------------------------------------------------------------
1. Run /fix-errors to start parallel fixing
2. Run /fix-errors forge/api --type lint to fix forge/api lint only
3. Run /fix-errors --priority critical to fix critical issues first
4. Fix critical build errors in compose/api manually (require refactoring)
================================================================
```

### 5. Priority Assignment

Issues are assigned priority automatically:

| Error Type | Condition | Priority |
|-----------|-----------|----------|
| Build error | TypeScript compiler error | Critical |
| Lint error | `@typescript-eslint/no-explicit-any` | Medium |
| Lint error | `no-unused-vars` | Low |
| Lint error | `no-console` | Low |
| Test failure | Test assertion failed | High |
| Test failure | Test crashed (unhandled error) | Critical |

## Auto-Fix Candidates

The scan output marks which issues are auto-fixable:

```
[AUTO-FIX] apps/forge/web/src/components/agent-chat.vue:5
           indent — Expected indentation of 2 spaces but found 4.
```

Auto-fixable issues can be resolved by `/fix-errors` without manual review.

## Output File (Optional)

To save results to a file for later reference:

```
/scan-errors --output .monitor/scan-results.json
```

This saves the structured results as JSON alongside the console output.

## Related

- **`/fix-errors`** - Fix issues found by this scan
- **`/monitor`** - Full codebase health analysis (includes scan as optional step)
- **`/test`** - Run tests for specific products
