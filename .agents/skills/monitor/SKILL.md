---
name: monitor
description: "Run codebase monitoring analysis (incremental or full). Analyzes files hierarchically, evaluates health, identifies issues, and saves monitoring artifacts to .monitor/ files."
user-invocable: true
allowed-tools: Read Write Edit Grep Glob Bash Agent
argument-hint: "[scope] [--full] [--quality] - Scope: 'apps/forge', 'apps/compose', 'apps/auth', 'apps/ambient', 'project', or entire project (default). --full: Full analysis. --quality: Include quality scanning."
---

# /monitor Command

## Purpose

Run codebase monitoring analysis to analyze files hierarchically, evaluate codebase health, identify issues, and generate monitoring artifacts saved to `.monitor/` files on disk.

## Usage

```
/monitor [scope] [--full] [--quality]
```

**Arguments:**
- `scope` (optional): Specific directory to analyze
  - `apps/forge` - Forge product (both api and web)
  - `apps/forge/api` - Forge API only
  - `apps/forge/web` - Forge Web only
  - `apps/compose` - Compose product
  - `apps/compose/api` - Compose API only
  - `apps/compose/web` - Compose Web only
  - `apps/auth` - Auth API
  - `apps/admin` - Admin Web
  - `apps/ambient` - All ambient products
  - `apps/ambient/pulse` - Pulse only
  - `apps/ambient/bridge` - Bridge only
  - `apps/command` - Command Web
  - `project` - Project-level files only (excludes apps/)
  - (no scope) - Analyze entire project (default)
- `--full` (optional): Full analysis ignoring last monitor date (default is incremental)
- `--quality` (optional): Also run build/lint/test scans and include in report

## Examples

```
/monitor
# Analyze entire project (incremental)

/monitor --full
# Analyze entire project (full - all files)

/monitor apps/forge
# Analyze Forge product only (incremental)

/monitor apps/forge/api --full
# Full analysis of Forge API

/monitor project
# Project-level files only (excludes apps/)

/monitor apps/compose --quality
# Compose with quality scanning (build/lint/test)

/monitor --full --quality
# Full project analysis with quality scanning
```

## Workflow

### 1. Determine Scope

Map scope argument to directory path(s).

### 2. Load Existing Artifact (if exists)

Artifact paths:
- `.monitor/all.json` - Entire project
- `.monitor/project.json` - Project-level only
- `.monitor/apps-forge.json` - Forge product
- `.monitor/apps-forge-api.json` - Forge API
- `.monitor/apps-forge-web.json` - Forge Web
- `.monitor/apps-compose.json` - Compose product
- `.monitor/apps-compose-api.json` - Compose API
- `.monitor/apps-compose-web.json` - Compose Web
- `.monitor/apps-auth.json` - Auth API
- `.monitor/apps-admin.json` - Admin Web
- `.monitor/apps-ambient.json` - All ambient
- `.monitor/apps-ambient-pulse.json` - Pulse
- `.monitor/apps-ambient-bridge.json` - Bridge
- `.monitor/apps-command.json` - Command Web

Extract `lastMonitorDate` for incremental analysis.

### 3. Call Monitoring Agent

Call `codebase-monitoring-agent` with scope, incremental mode, and existing artifact.

### 4. Agent Analysis

The agent:
- Analyzes files hierarchically (reads file by file)
- Evaluates codebase health per product
- Identifies issues (architecture violations, missing patterns, technical debt)
- Groups related issues into refactorings
- Generates prioritized issues list

### 5. Save Artifact to File

Agent saves/updates artifact in `.monitor/` directory including:
- All file analyses
- Hierarchical breakdown
- Prioritized issues
- Refactorings section
- Updated `lastMonitorDate`

### 6. Quality Scanning (if --quality flag)

If `--quality` is provided:
1. Run `npm run build` for products in scope
2. Run `npm run lint` for products in scope
3. Run `npm run test` for products in scope
4. Parse outputs into structured issue list
5. Include quality issues in the monitoring report output
6. Save quality section to artifact file

### 7. Display Summary to Console

```
Monitoring complete!

Scope: apps/forge
Files analyzed: 87 (23 new, 64 unchanged)
Issues found: 31
  High urgency: 6
  Medium urgency: 18
  Low urgency: 7

Top Issues:
  #1: ExecutionContext not consistently passed through agent pipeline (high urgency)
  #2: Marketing swarm missing A2A endpoint (high urgency)
  #3: Missing observability plane calls in legal department agent (medium urgency)
  ...

Refactorings:
  - a2a-endpoint-compliance (3 issues, high priority)
  - observability-plane-consistency (4 issues, medium priority)

Artifact saved to: .monitor/apps-forge.json
```

## Artifact Structure

The `.monitor/*.json` files contain:

```json
{
  "lastMonitorDate": "2026-03-14T10:00:00Z",
  "scope": "apps/forge",
  "summary": {
    "filesAnalyzed": 87,
    "issuesFound": 31,
    "highUrgency": 6,
    "mediumUrgency": 18,
    "lowUrgency": 7
  },
  "issues": [
    {
      "id": 1,
      "title": "ExecutionContext not consistently passed",
      "file": "apps/forge/api/src/agents/marketing-swarm.service.ts",
      "urgency": "high",
      "severity": "high",
      "description": "...",
      "proposedFix": "...",
      "refactoring": "execution-context-flow"
    }
  ],
  "refactorings": [
    {
      "name": "a2a-endpoint-compliance",
      "priority": "high",
      "issueIds": [2, 7, 12]
    }
  ],
  "fileAnalyses": { ... }
}
```

## Incremental Monitoring

**Default (incremental):**
- Only analyzes files changed/added since `lastMonitorDate`
- Preserves existing analyses for unchanged files
- Updates `lastMonitorDate` after analysis

**Full Analysis (`--full` flag):**
- Analyzes all files regardless of modification date
- Replaces existing artifact completely
- Use for first-time monitoring or complete refresh

## Related

- **`codebase-monitoring-agent.md`** - Performs the analysis
- **`/harden`** - Uses monitoring artifacts for hardening
- **`/scan-errors`** - Quality-only scanning
- **`/fix-errors`** - Parallel fixing of quality issues
