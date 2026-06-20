#!/bin/zsh
set -u

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

APP_DIR="/Users/yisheng/Documents/SLUAN/Inspiration-diary"
PHOTOPRISM_DIR="/Users/yisheng/Documents/Codex/2026-06-19/files-mentioned-by-the-user-generated/work/photoprism"
LOG_DIR="$HOME/Library/Logs/InspirationDiary"
LOG_FILE="$LOG_DIR/docker-autostart.log"

mkdir -p "$LOG_DIR"
exec >> "$LOG_FILE" 2>&1

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting Docker services"

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not ready; opening Docker Desktop"
  open -gj -a Docker >/dev/null 2>&1 || true
fi

docker_ready=false
for _ in {1..90}; do
  if docker info >/dev/null 2>&1; then
    docker_ready=true
    break
  fi
  sleep 2
done

if [ "$docker_ready" != "true" ]; then
  echo "Docker did not become ready in time"
  exit 1
fi

echo "Starting existing containers"
docker start photoprism-mariadb-1 >/dev/null 2>&1 || true
docker start photoprism-photoprism-1 >/dev/null 2>&1 || true
docker start inspiration-diary-app-1 >/dev/null 2>&1 || true

if ! docker ps --format '{{.Names}}' | grep -qx 'photoprism-photoprism-1'; then
  if [ -d "$PHOTOPRISM_DIR" ]; then
    echo "PhotoPrism container missing or stopped; falling back to compose"
    docker compose -f "$PHOTOPRISM_DIR/compose.yaml" up -d
  else
    echo "PhotoPrism directory not found: $PHOTOPRISM_DIR"
  fi
fi

if ! docker ps --format '{{.Names}}' | grep -qx 'inspiration-diary-app-1'; then
  if [ -d "$APP_DIR" ]; then
    echo "Inspiration Diary container missing or stopped; falling back to compose"
    cd "$APP_DIR" || exit 1
    docker compose up -d
  else
    echo "App directory not found: $APP_DIR"
  fi
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Docker services startup finished"
