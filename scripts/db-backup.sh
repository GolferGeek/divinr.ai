#!/bin/bash
# Database backup script for Divinr.ai
# Creates a full compressed backup in backups/archive/ (gitignored)
# and updates the schema snapshot in apps/api/db/ (tracked in git)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ARCHIVE_DIR="$PROJECT_DIR/backups/archive"
DB_DIR="$PROJECT_DIR/apps/api/db"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

mkdir -p "$ARCHIVE_DIR"

echo "=== Divinr.ai Database Backup ==="
echo "Timestamp: $TIMESTAMP"

# 1. Full backup (compressed, gitignored)
echo ""
echo "1. Full backup (schema + data)..."
docker exec supabase_db_divinr.ai pg_dump -U postgres -d postgres \
  --no-owner --no-privileges --clean --if-exists \
  -n public -n authz -n prediction -n messaging \
  | gzip > "$ARCHIVE_DIR/divinr-full-$TIMESTAMP.sql.gz"
echo "   -> $(ls -lh "$ARCHIVE_DIR/divinr-full-$TIMESTAMP.sql.gz" | awk '{print $5}')"

# 2. Schema-only snapshot (tracked in git)
echo ""
echo "2. Schema snapshot..."
docker exec supabase_db_divinr.ai pg_dump -U postgres -d postgres \
  --schema-only --no-owner --no-privileges \
  -n public -n authz -n prediction -n messaging \
  > "$DB_DIR/schema-snapshot.sql"
echo "   -> $(ls -lh "$DB_DIR/schema-snapshot.sql" | awk '{print $5}')"

# 3. Seed data snapshot (tracked in git)
echo ""
echo "3. Seed data snapshot..."
docker exec supabase_db_divinr.ai pg_dump -U postgres -d postgres \
  --data-only --no-owner --no-privileges \
  -t 'prediction.domains' \
  -t 'prediction.universes' \
  -t 'prediction.source_catalog' \
  -t 'authz.rbac_roles' \
  -t 'authz.rbac_permissions' \
  -t 'authz.users' \
  -t 'authz.rbac_user_roles' \
  > "$DB_DIR/seed-data-snapshot.sql"
echo "   -> $(ls -lh "$DB_DIR/seed-data-snapshot.sql" | awk '{print $5}')"

# 4. Cleanup old archives (keep last 10)
echo ""
echo "4. Archive cleanup (keeping last 10)..."
ARCHIVE_COUNT=$(ls -1 "$ARCHIVE_DIR"/divinr-full-*.sql.gz 2>/dev/null | wc -l)
if [ "$ARCHIVE_COUNT" -gt 10 ]; then
  ls -1t "$ARCHIVE_DIR"/divinr-full-*.sql.gz | tail -n +11 | xargs rm -f
  echo "   Removed $((ARCHIVE_COUNT - 10)) old archives"
else
  echo "   $ARCHIVE_COUNT archives, no cleanup needed"
fi

# 5. Table stats
echo ""
echo "5. Table stats:"
docker exec supabase_db_divinr.ai psql -U postgres -d postgres -c "
SELECT schemaname || '.' || relname as table_name,
       n_live_tup as row_count
FROM pg_stat_user_tables
WHERE schemaname IN ('prediction', 'messaging', 'authz', 'public')
  AND n_live_tup > 0
ORDER BY n_live_tup DESC
LIMIT 15;
"

echo ""
echo "=== Backup complete ==="
echo "Archive: $ARCHIVE_DIR/divinr-full-$TIMESTAMP.sql.gz"
echo "Schema:  $DB_DIR/schema-snapshot.sql (commit this)"
echo "Seeds:   $DB_DIR/seed-data-snapshot.sql (commit this)"
