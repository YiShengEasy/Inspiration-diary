# Alibaba Cloud ECS Deployment

Target instance:

- Region: Hangzhou
- Size: 2 vCPU, 2 GiB RAM
- Disk: 40 GiB
- Bandwidth: 3 Mbps fixed bandwidth

This ECS instance should run only the app, host PostgreSQL, and the host reverse proxy. Do not run PhotoPrism in production. Media files must use Alibaba Cloud OSS so playback and downloads do not consume the ECS disk or the 3 Mbps bandwidth budget.

## Host PostgreSQL

Install PostgreSQL on the ECS host and keep it bound to localhost:

```bash
sudo dnf install -y postgresql-server postgresql-contrib
sudo postgresql-setup --initdb
sudo systemctl enable --now postgresql
```

Create the app database and user:

```bash
sudo -u postgres psql
```

```sql
CREATE USER inspiration WITH PASSWORD '<strong-password>';
CREATE DATABASE notebook OWNER inspiration;
GRANT ALL PRIVILEGES ON DATABASE notebook TO inspiration;
```

Use this connection string in `.env.production`:

```env
DATABASE_TYPE=postgres
DATABASE_URL=postgresql://inspiration:<strong-password>@127.0.0.1:5432/notebook
DATABASE_SSL=false
```

## First Deploy

Prepare the production environment file from placeholders:

```bash
cp .env.production.example .env.production
```

Edit `.env.production` on the ECS and fill in real values there. Do not commit real credentials. Production should keep these storage providers on OSS:

```env
APP_ENV=production
DEPLOYMENT_PROFILE=production
THIRD_PARTY_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
THIRD_PARTY_API_KEY=<third-party-api-key>
THIRD_PARTY_MODEL=doubao-seed-2.0-code
THIRD_PARTY_THINKING=false
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

Validate and start production:

```bash
npm run config:production
npm ci
npm run build
NODE_ENV=production APP_ENV_FILE=.env.production npm run start
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

When testing through a plain HTTP IP address, browsers will not send cookies marked `Secure`. You can temporarily set:

```env
AUTH_COOKIE_SECURE=false
ALLOW_INSECURE_COOKIE=true
```

Switch back to `AUTH_COOKIE_SECURE=true` and remove the insecure override after HTTPS is enabled.

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

Run a PostgreSQL dump on the ECS host:

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
npm run config:production
curl -fsS http://127.0.0.1:3005/ >/dev/null
```

For the ECS size above, keep memory pressure low:

- Avoid running PhotoPrism, development servers, or extra media workers on the production host.
- Keep large media out of Docker volumes and on OSS.
- Watch disk usage before and after database backups.
