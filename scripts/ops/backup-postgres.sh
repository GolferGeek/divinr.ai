#!/usr/bin/env bash
# Divinr.ai — Postgres backup to external drive.
#
# Dumps the Supabase Postgres (port 7011) to /mnt/divinr-backup/postgres/
# Runs every 3 hours via systemd timer.
#
# Tiered retention:
#   - Last 24 hours: keep all (8 backups @ 3h apart)
#   - 1-7 days old:  keep 1 per day
#   - 7-30 days old: keep 1 per week
#   - Older than 30: delete
#
# Exit codes:
#   0 — success
#   1 — backup mount not available
#   2 — pg_dump failed
#   3 — backup file is suspiciously small (< 1 MB)

set -euo pipefail

BACKUP_ROOT="/mnt/divinr-backup/postgres"
PG_CONTAINER="supabase_db_divinr.ai"
PG_USER="postgres"
PG_DB="postgres"
MIN_SIZE_BYTES=1048576   # 1 MB — anything smaller means something's wrong

TIMESTAMP=$(date -u +"%Y-%m-%dT%H%M%SZ")
LOG_FILE="${BACKUP_ROOT}/backup.log"

log() {
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*" | tee -a "${LOG_FILE}"
}

# Verify backup mount is available
if [ ! -d "${BACKUP_ROOT}" ] || ! mountpoint -q /mnt/divinr-backup; then
  echo "ERROR: Backup drive not mounted at /mnt/divinr-backup" >&2
  exit 1
fi

log "=== Backup started ==="
log "Target: ${BACKUP_ROOT}/${TIMESTAMP}.sql.gz"

BACKUP_DIR="${BACKUP_ROOT}/${TIMESTAMP}"
mkdir -p "${BACKUP_DIR}"
BACKUP_FILE="${BACKUP_DIR}/postgres.sql.gz"
GLOBALS_FILE="${BACKUP_DIR}/globals.sql.gz"

# Verify container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${PG_CONTAINER}$"; then
  log "ERROR: Container ${PG_CONTAINER} is not running"
  rmdir "${BACKUP_DIR}" 2>/dev/null
  exit 2
fi

# 1. Main postgres database — everything that matters:
#    auth (users), authz (RBAC), prediction (business data),
#    messaging, storage metadata, realtime, extensions
log "Dumping postgres database..."
if ! docker exec "${PG_CONTAINER}" pg_dump \
  -U "${PG_USER}" \
  -d "${PG_DB}" \
  --no-owner \
  --no-privileges \
  --clean \
  --if-exists \
  --format=plain \
  2>>"${LOG_FILE}" | gzip -9 > "${BACKUP_FILE}"; then
  log "ERROR: pg_dump (postgres) failed"
  rm -rf "${BACKUP_DIR}"
  exit 2
fi

# 2. Global roles & tablespaces (tiny safety net for full-portability restore)
log "Dumping globals (roles, tablespaces)..."
if ! docker exec "${PG_CONTAINER}" pg_dumpall \
  -U "${PG_USER}" \
  --globals-only \
  --no-role-passwords \
  2>>"${LOG_FILE}" | gzip -9 > "${GLOBALS_FILE}"; then
  log "WARN: pg_dumpall globals failed — continuing"
  rm -f "${GLOBALS_FILE}"
fi

# Sanity-check the main backup size
BACKUP_SIZE=$(stat -c%s "${BACKUP_FILE}")
if [ "${BACKUP_SIZE}" -lt "${MIN_SIZE_BYTES}" ]; then
  log "ERROR: Main backup is only ${BACKUP_SIZE} bytes — suspiciously small, likely failed mid-dump"
  mv "${BACKUP_DIR}" "${BACKUP_DIR}.suspect"
  exit 3
fi

TOTAL_BACKUP_SIZE=$(du -sh "${BACKUP_DIR}" | awk '{print $1}')
log "Backup complete: ${BACKUP_DIR} (${TOTAL_BACKUP_SIZE})"
log "  postgres.sql.gz: $(du -h ${BACKUP_FILE} 2>/dev/null | awk '{print $1}' || echo 'missing')"
log "  globals.sql.gz: $(du -h ${GLOBALS_FILE} 2>/dev/null | awk '{print $1}' || echo 'missing')"

# ── Tiered Retention ────────────────────────────────────────────────
#
# Walk all backups. For each, decide which "bucket" it belongs to and
# keep only the newest file in each bucket beyond 24h.
#
# Buckets:
#   - Recent (< 24h): keep all
#   - Daily (1-7 days): keep 1 per YYYY-MM-DD
#   - Weekly (7-30 days): keep 1 per YYYY-WW (ISO week)
#   - Archive (> 30 days): delete

log "Applying tiered retention..."

NOW_EPOCH=$(date +%s)
PRUNED=0

# Associative arrays to track "first seen per bucket"
declare -A DAILY_KEPT
declare -A WEEKLY_KEPT

# Process oldest-first so we keep the NEWEST file in each bucket
# (by deleting older ones when we see a newer one in the same bucket)
# Actually easier: process newest-first, keep first hit per bucket, delete rest.

for dir in $(find "${BACKUP_ROOT}" -maxdepth 1 -mindepth 1 -type d -printf "%T@ %p\n" | sort -rn | awk '{print $2}'); do
  dir_mtime=$(stat -c%Y "${dir}")
  age_seconds=$((NOW_EPOCH - dir_mtime))
  age_hours=$((age_seconds / 3600))
  age_days=$((age_seconds / 86400))

  if [ ${age_hours} -lt 24 ]; then
    # Keep all backups from last 24 hours
    continue
  elif [ ${age_days} -lt 7 ]; then
    # Daily tier: keep one per calendar day
    day_key=$(date -d "@${dir_mtime}" +"%Y-%m-%d")
    if [ -n "${DAILY_KEPT[$day_key]:-}" ]; then
      sudo rm -rf "${dir}"
      PRUNED=$((PRUNED + 1))
    else
      DAILY_KEPT[$day_key]=1
    fi
  elif [ ${age_days} -lt 30 ]; then
    # Weekly tier: keep one per ISO week
    week_key=$(date -d "@${dir_mtime}" +"%Y-W%V")
    if [ -n "${WEEKLY_KEPT[$week_key]:-}" ]; then
      sudo rm -rf "${dir}"
      PRUNED=$((PRUNED + 1))
    else
      WEEKLY_KEPT[$week_key]=1
    fi
  else
    # Archive tier: delete
    sudo rm -rf "${dir}"
    PRUNED=$((PRUNED + 1))
  fi
done

log "Pruned ${PRUNED} backup(s) under tiered retention"

# Report
REMAINING=$(find "${BACKUP_ROOT}" -maxdepth 1 -mindepth 1 -type d | wc -l)
TOTAL_USED=$(du -sh "${BACKUP_ROOT}" | awk '{print $1}')
DISK_AVAIL=$(df -h /mnt/divinr-backup | awk 'NR==2 {print $4}')
log "Backups on disk: ${REMAINING} | Total backup size: ${TOTAL_USED} | Free space: ${DISK_AVAIL}"

log "=== Backup finished successfully ==="
exit 0
