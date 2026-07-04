# Alibaba Cloud ECS Deployment

Target instance:

- Region: Hangzhou
- Size: 2 vCPU, 2 GiB RAM
- Disk: 40 GiB
- Bandwidth: 3 Mbps fixed bandwidth

This ECS instance should run only the app container, PostgreSQL, and the host reverse proxy. Do not run PhotoPrism in production. Media files must use Alibaba Cloud OSS so playback and downloads do not consume the ECS disk or the 3 Mbps bandwidth budget.

## First Deploy

Prepare the production environment file from placeholders:

```bash
cp .env.production.example .env.production
```

Edit `.env.production` on the ECS and fill in real values there. Do not commit real credentials. Production should keep these storage providers on OSS:

```env
APP_ENV=production
DEPLOYMENT_PROFILE=production
IMAGE_STORAGE_PROVIDER=oss
VIDEO_STORAGE_PROVIDER=oss
IMAGE_ASSET_STORAGE_PROVIDER=oss
OSS_REGION=oss-cn-hangzhou
OSS_BUCKET=<bucket-name>
OSS_ENDPOINT=https://oss-cn-hangzhou.aliyuncs.com
OSS_ACCESS_KEY_ID=<ram-access-key-id>
OSS_ACCESS_KEY_SECRET=<ram-access-key-secret>
OSS_PUBLIC_BASE_URL=https://<bucket-name>.oss-cn-hangzhou.aliyuncs.com
```

Validate and start production Docker:

```bash
npm run config:production
npm run docker:production:detached
docker compose -f docker-compose.production.yml ps
```

The app is exposed on the host at:

```text
http://127.0.0.1:3005
```

## Reverse Proxy

Use Caddy or Nginx on the ECS host and terminate HTTPS at the proxy. Forward the public site to:

```text
http://127.0.0.1:3005
```

Keep the Docker app port bound for local reverse proxy traffic only where possible. Avoid exposing PostgreSQL to the public network.

## Production Storage Policy

Production must use OSS for user media:

```env
DEPLOYMENT_PROFILE=production
IMAGE_STORAGE_PROVIDER=oss
VIDEO_STORAGE_PROVIDER=oss
IMAGE_ASSET_STORAGE_PROVIDER=oss
```

PhotoPrism is local-only. It is useful for development, but it is not sized for this 2 vCPU, 2 GiB, 40 GiB, 3 Mbps ECS production deployment.

Recommended OSS setup:

- Use a Hangzhou OSS bucket near the ECS.
- Use a RAM user or role with the smallest required OSS permissions.
- Keep the OSS access key only in `.env.production` on the server or in a secret manager.
- Prefer CDN or OSS public/custom domain delivery for media if traffic grows.

## Backups

Run a PostgreSQL dump on the ECS:

```bash
./scripts/backup-postgres.sh
```

By default, the backup is written under `./backups`:

```text
backups/inspiration-diary-YYYYMMDD-HHMMSS.sql
```

Upload the generated `.sql` file to OSS or another backup location after each backup. The ECS disk is only 40 GiB, so local backup files should be rotated after the remote copy is confirmed.

Example with a custom local backup directory:

```bash
BACKUP_DIR=/var/backups/inspiration-diary ./scripts/backup-postgres.sh
```

Suggested cadence:

- Daily database backup while the service is active.
- Copy each backup to OSS immediately after creation.
- Periodically restore a backup into a disposable PostgreSQL instance to verify that dumps are usable.

## Operational Checks

After deploy or update:

```bash
docker compose -f docker-compose.production.yml ps
docker compose -f docker-compose.production.yml logs --tail=100 app
npm run config:production
```

For the ECS size above, keep memory pressure low:

- Avoid running PhotoPrism, development servers, or extra media workers on the production host.
- Keep large media out of Docker volumes and on OSS.
- Watch disk usage before and after database backups.
