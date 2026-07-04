#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

docker compose -f docker-compose.production.yml exec -T postgres \
  pg_dump -U postgres -d notebook \
  > "$BACKUP_DIR/inspiration-diary-$TIMESTAMP.sql"

echo "Backup written to $BACKUP_DIR/inspiration-diary-$TIMESTAMP.sql"
