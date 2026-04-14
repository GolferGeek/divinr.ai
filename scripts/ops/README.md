# Divinr.ai Ops Scripts

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
