#!/usr/bin/env bash
set -euo pipefail

PROD_HOST="${PROD_HOST:-223.6.255.128}"
PROD_USER="${PROD_USER:-ecs-user}"
PROD_DIR="${PROD_DIR:-/home/ecs-user/inspiration-diary-src}"
PROD_SERVICE="${PROD_SERVICE:-inspiration-diary.service}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
REMOTE="${PROD_USER}@${PROD_HOST}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

if [[ -n "${RELEASE_VERSION:-}" ]]; then
  VERSION="$RELEASE_VERSION"
elif [[ -f VERSION ]]; then
  VERSION="$(tr -d '[:space:]' < VERSION)"
else
  VERSION="$(node -p "require('./package.json').version")"
fi

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$ ]]; then
  echo "Invalid release version: $VERSION" >&2
  exit 1
fi

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_command git
require_command npm
require_command rsync
require_command ssh
require_command scp
require_command tar

if [[ ! -f "$SSH_KEY" ]]; then
  echo "SSH key not found: $SSH_KEY" >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Tracked files have uncommitted changes. Commit or stash them before release." >&2
  git status --short
  exit 1
fi

COMMIT="$(git rev-parse --short HEAD)"
ARCHIVE="/tmp/inspiration-diary-release-$VERSION-$COMMIT-$TIMESTAMP.tgz"
echo "Release version: $VERSION"
echo "Local commit: $COMMIT"
echo "Remote: $REMOTE:$PROD_DIR"

echo "Running local checks..."
npm run lint
npm run build
git archive --format=tar.gz --output "$ARCHIVE" HEAD

echo "Checking remote service..."
ssh -i "$SSH_KEY" -o BatchMode=yes "$REMOTE" \
  "test -d '$PROD_DIR' && command -v pg_dump >/dev/null && command -v psql >/dev/null && systemctl is-active '$PROD_SERVICE'"

echo "Creating remote source and database backups..."
ssh -i "$SSH_KEY" -o BatchMode=yes "$REMOTE" bash -s -- "$PROD_DIR" "$TIMESTAMP" <<'REMOTE_BACKUP'
set -euo pipefail
PROD_DIR="$1"
TIMESTAMP="$2"
cd "$PROD_DIR"
mkdir -p backups
tar -czf "backups/source-before-release-$TIMESTAMP.tgz" \
  --exclude='./.git' \
  --exclude='./node_modules' \
  --exclude='./backups' \
  --exclude='./dist' \
  --exclude='./.env' \
  --exclude='./.env.local' \
  --exclude='./.env.production' \
  --exclude='./.env.production.bak-*' \
  .
set -a
source .env.production
set +a
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is missing in remote .env.production" >&2
  exit 1
fi
pg_dump --format=custom --no-owner --no-acl \
  --file "backups/prod-before-release-$TIMESTAMP.dump" \
  "$DATABASE_URL"
ls -lh "backups/source-before-release-$TIMESTAMP.tgz" "backups/prod-before-release-$TIMESTAMP.dump"
REMOTE_BACKUP

echo "Uploading release archive..."
scp -i "$SSH_KEY" "$ARCHIVE" "$REMOTE:/tmp/$(basename "$ARCHIVE")"
rm -f "$ARCHIVE"

echo "Installing and building on remote..."
ssh -i "$SSH_KEY" -o BatchMode=yes "$REMOTE" bash -s -- "$PROD_DIR" "$PROD_SERVICE" "$VERSION" "$COMMIT" "$TIMESTAMP" "$(basename "$ARCHIVE")" <<'REMOTE_DEPLOY'
set -euo pipefail
PROD_DIR="$1"
PROD_SERVICE="$2"
VERSION="$3"
COMMIT="$4"
TIMESTAMP="$5"
ARCHIVE_NAME="$6"
STAGING="/tmp/inspiration-diary-release-$TIMESTAMP"
rm -rf "$STAGING"
mkdir -p "$STAGING"
tar -xzf "/tmp/$ARCHIVE_NAME" -C "$STAGING"
find "$PROD_DIR" -mindepth 1 -maxdepth 1 \
  ! -name '.env' \
  ! -name '.env.local' \
  ! -name '.env.production' \
  ! -name '.env.production.bak-*' \
  ! -name 'backups' \
  ! -name 'node_modules' \
  ! -name 'dist' \
  -exec rm -rf {} +
cp -a "$STAGING"/. "$PROD_DIR"/
rm -rf "$STAGING" "/tmp/$ARCHIVE_NAME"
cd "$PROD_DIR"
npm ci
npm run build
cat > .release-info.json <<JSON
{
  "version": "$VERSION",
  "commit": "$COMMIT",
  "releasedAt": "$TIMESTAMP",
  "service": "$PROD_SERVICE"
}
JSON
sudo -n systemctl restart "$PROD_SERVICE"
systemctl is-active "$PROD_SERVICE"
journalctl -u "$PROD_SERVICE" -n 40 --no-pager
REMOTE_DEPLOY

echo "Checking public endpoint..."
HTTP_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' "http://$PROD_HOST:3005/")"
if [[ "$HTTP_STATUS" != "200" ]]; then
  echo "Release failed health check. HTTP status: $HTTP_STATUS" >&2
  exit 1
fi

echo "Release complete: $VERSION ($COMMIT)"
echo "Remote backups:"
echo "  $PROD_DIR/backups/source-before-release-$TIMESTAMP.tgz"
echo "  $PROD_DIR/backups/prod-before-release-$TIMESTAMP.dump"
