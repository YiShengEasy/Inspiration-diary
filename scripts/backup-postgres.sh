#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

if [[ -f ".env.production" ]]; then
  set -a
  # shellcheck disable=SC1091
  source ".env.production"
  set +a
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required. Set it in .env.production or export it before running this script." >&2
  exit 1
fi

pg_dump "$DATABASE_URL" > "$BACKUP_DIR/inspiration-diary-$TIMESTAMP.sql"

echo "Backup written to $BACKUP_DIR/inspiration-diary-$TIMESTAMP.sql"
