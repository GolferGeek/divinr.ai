#!/usr/bin/env bash
# Divinr.ai — Postgres restore from backup.
#
# Usage:
#   ./restore-postgres.sh <backup-timestamp-dir>
#
# Example:
#   ./restore-postgres.sh 2026-04-14T154222Z
#   ./restore-postgres.sh latest   # restore most recent backup
#
# WARNING: This will overwrite the current database. Prompts before proceeding.

set -euo pipefail

BACKUP_ROOT="/mnt/divinr-backup/postgres"
PG_CONTAINER="supabase_db_divinr.ai"
PG_USER="postgres"
PG_DB="postgres"

if [ $# -ne 1 ]; then
  echo "Usage: $0 <backup-timestamp-dir | latest>"
  echo ""
  echo "Available backups:"
  find "${BACKUP_ROOT}" -maxdepth 1 -mindepth 1 -type d -printf "  %f\n" | sort -r | head -20
  exit 1
fi

TARGET="$1"

if [ "${TARGET}" = "latest" ]; then
  TARGET=$(find "${BACKUP_ROOT}" -maxdepth 1 -mindepth 1 -type d -printf "%T@ %f\n" | sort -rn | head -1 | awk '{print $2}')
  if [ -z "${TARGET}" ]; then
    echo "ERROR: No backups found in ${BACKUP_ROOT}"
    exit 1
  fi
  echo "Resolved 'latest' → ${TARGET}"
fi

BACKUP_DIR="${BACKUP_ROOT}/${TARGET}"
BACKUP_FILE="${BACKUP_DIR}/postgres.sql.gz"

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "ERROR: Backup file not found: ${BACKUP_FILE}"
  exit 1
fi

BACKUP_SIZE=$(du -h "${BACKUP_FILE}" | awk '{print $1}')
BACKUP_MTIME=$(stat -c '%y' "${BACKUP_FILE}")

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  RESTORE WARNING"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "About to restore from:"
echo "  File:     ${BACKUP_FILE}"
echo "  Size:     ${BACKUP_SIZE}"
echo "  Taken:    ${BACKUP_MTIME}"
echo ""
echo "Target: ${PG_CONTAINER}:${PG_DB}"
echo ""
echo "This will:"
echo "  1. DROP all existing tables and data in the database"
echo "  2. Restore from the backup"
echo "  3. All current users, predictions, clubs, etc. will be REPLACED"
echo ""
echo "═══════════════════════════════════════════════════════════"
read -p "Type 'yes' to proceed: " -r
if [ "${REPLY}" != "yes" ]; then
  echo "Aborted."
  exit 0
fi

echo ""
echo "Starting restore..."

# Verify container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${PG_CONTAINER}$"; then
  echo "ERROR: Container ${PG_CONTAINER} is not running. Start Supabase first."
  exit 2
fi

# Stream the gzipped backup into psql inside the container
echo "Restoring database (this can take a minute or two)..."
if ! gunzip -c "${BACKUP_FILE}" | docker exec -i "${PG_CONTAINER}" psql \
  -U "${PG_USER}" \
  -d "${PG_DB}" \
  -v ON_ERROR_STOP=0 \
  --quiet \
  > /tmp/restore.log 2>&1; then
  echo "WARN: psql exited non-zero. Check /tmp/restore.log for details."
  echo "Last 20 lines:"
  tail -20 /tmp/restore.log
  echo ""
  echo "Note: many 'errors' during restore are benign (objects already exist etc.)."
  echo "Verify by running a few sanity queries below."
fi

echo ""
echo "Restore complete. Running sanity checks..."
echo ""

# Sanity queries
docker exec "${PG_CONTAINER}" psql -U "${PG_USER}" -d "${PG_DB}" -c "
  SELECT
    (SELECT count(*) FROM auth.users) AS users,
    (SELECT count(*) FROM prediction.market_analysts) AS analysts,
    (SELECT count(*) FROM prediction.instruments) AS instruments,
    (SELECT count(*) FROM prediction.market_predictions) AS predictions,
    (SELECT count(*) FROM prediction.clubs) AS clubs;
" 2>&1

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Restore finished."
echo "  Full log at /tmp/restore.log"
echo "  Verify by logging into the app."
echo "═══════════════════════════════════════════════════════════"
