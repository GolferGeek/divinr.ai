# Divinr.ai Ops Scripts

## API + Stripe-listener systemd units (spark)

Two units in `systemd/` boot the production stack on the spark machine:

- `divinr-api.service` — runs the built API (`node dist/src/main.js`) with
  `Restart=always`. Reads env from repo-root `.env`. Logs to journald
  (`journalctl -u divinr-api -f`).
- `divinr-stripe-listen.service` — runs `stripe listen --forward-to
  localhost:7100/billing/webhooks/stripe`. Depends on a previous
  `stripe login` having populated `~/.config/stripe/config.toml`. Will
  go away once the dashboard-registered webhook lands (per the
  stripe-cutover runbook).

### Install on spark

```bash
cd ~/projects/divinr.ai
git pull
pnpm install && pnpm --filter @divinr/api run build  # if dist/ is stale
bash scripts/ops/install-services.sh
```

The install script is idempotent — re-run it after a code update to
refresh the unit files. It detects `node` and `stripe` paths
automatically, or honors `NODE_BIN=...` / `STRIPE_BIN=...` overrides.

### Manage

**From the Mac dev box (no SSH needed):**

```bash
pnpm spark:restart   # ssh into spark and bounce both units
pnpm spark:deploy    # ssh into spark, git pull, install, build, restart
```

Both wrap `ssh -t golfergeek@spark-51e5.local …`; the TTY lets sudo
prompt for a password if you haven't set up passwordless sudo for the
`divinr-*` units. Override the SSH target via `SPARK_SSH=…` env var.

**On spark itself (e.g., from a Cursor SSH terminal):**

```bash
pnpm restart                           # bounce both units
sudo systemctl status  divinr-api
journalctl -u divinr-api -f
```

For a code-change deploy from on-spark, pull and rebuild first:

```bash
git pull && pnpm install && pnpm --filter @divinr/api run build && pnpm restart
```

**Do not run `pnpm --filter @divinr/api run dev:up` on spark after
installing these units** — it would `pkill` the systemd-managed node
and trigger a restart fight. `dev-up.sh` is for the dev Mac only.

## Postgres Backup

Automated backups of the Supabase Postgres database to the external drive mounted at `/mnt/divinr-backup`.

### What's Backed Up

- `postgres.sql.gz` — the main database. Contains:
  - **auth** schema — Supabase users, sessions, MFA, OAuth
  - **authz** schema — RBAC (roles, permissions, invites, audit log)
  - **prediction** schema — all business data (predictions, analysts, portfolios, clubs, tournaments, learning)
  - **messaging** schema — chat channels and messages
  - **storage** schema — metadata about uploaded files
  - **realtime, extensions, graphql, vault, supabase_functions** — infrastructure
- `globals.sql.gz` — Postgres roles and tablespaces (tiny safety net for full-portability restore)

**Not backed up:**
- `_supabase` database (Supabase internal analytics logs — recreated on fresh install, ~1 GB of log telemetry)
- Storage volume file bytes (only 29 KB of files in Divinr currently; metadata is in `postgres.sql.gz`)

### Schedule

Runs every 3 hours via `divinr-backup.timer` (systemd).

### Retention

Tiered retention — newer backups are denser, older ones are sparser:

| Age | Kept |
|-----|------|
| Last 24 hours | All backups (8 per day @ 3h intervals) |
| 1-7 days | 1 per calendar day |
| 7-30 days | 1 per ISO week |
| Older than 30 days | Deleted |

Total on-disk commitment: ~19 backups max = **~6.3 GB** (329 MB per backup).

### Files

- `backup-postgres.sh` — creates a new timestamped backup directory with the files above
- `restore-postgres.sh` — restores from a backup (prompts before destructive action)
- `/etc/systemd/system/divinr-backup.service` — systemd service unit
- `/etc/systemd/system/divinr-backup.timer` — runs every 3h, persistent across reboots

### Manual Backup

```bash
./scripts/ops/backup-postgres.sh
```

### Check Timer Status

```bash
systemctl list-timers divinr-backup.timer
systemctl status divinr-backup.service
tail -f /mnt/divinr-backup/postgres/backup.log
```

### Restore Procedure

**From latest backup:**

```bash
./scripts/ops/restore-postgres.sh latest
```

**From specific backup:**

```bash
# List available backups
ls /mnt/divinr-backup/postgres/

# Restore
./scripts/ops/restore-postgres.sh 2026-04-14T155023Z
```

The script will prompt before making destructive changes and run sanity queries after.

### Disaster Recovery — Database Lost

If Spark's internal disk dies:

1. Fresh OS install on new storage
2. Re-install Supabase CLI and start a blank Supabase instance
3. Plug in the external backup drive
4. Clone the divinr.ai repo
5. Run `./scripts/ops/restore-postgres.sh latest`
6. Restart the API service

Backups are complete enough that this recovers all users, predictions, clubs, and history. The only losses are telemetry logs and 29 KB of storage files.
