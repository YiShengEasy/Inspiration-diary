# Production Release

The current production server runs the app with systemd, not Docker.

- Host: `223.6.255.128`
- User: `ecs-user`
- App directory: `/home/ecs-user/inspiration-diary-src`
- Service: `inspiration-diary.service`
- Database: PostgreSQL on the server
- Media: OSS

## Versioning

Use semantic versions: `MAJOR.MINOR.PATCH`.

- Patch, for fixes: `0.1.1`
- Minor, for user-facing features: `0.2.0`
- Major, for incompatible changes: `1.0.0`

Keep `VERSION`, `package.json`, and `package-lock.json` aligned before a release.

## Release Command

```bash
npm run release:prod
```

Optional overrides:

```bash
RELEASE_VERSION=0.1.1 npm run release:prod
PROD_HOST=223.6.255.128 PROD_USER=ecs-user npm run release:prod
```

## What The Script Does

1. Checks tracked files are clean.
2. Runs local `npm run lint`.
3. Runs local `npm run build`.
4. Verifies the remote app directory, PostgreSQL tools, and service state.
5. Creates a remote source backup.
6. Creates a remote PostgreSQL backup.
7. Creates a release archive from `git archive HEAD`, so only committed files are published.
8. Uploads the source archive and the locally built `dist` archive to the server.
9. Syncs source into the app directory, preserving env files, backups, and `node_modules`.
10. Extracts the local `dist` build on the server.
11. Runs `npm install --omit=dev --no-audit --no-fund` on the server for runtime dependencies.
12. Writes `.release-info.json` on the server.
13. Restarts `inspiration-diary.service`.
14. Checks the public homepage returns HTTP 200.

## Rollback

Source backup files are written to:

```text
/home/ecs-user/inspiration-diary-src/backups/source-before-release-<timestamp>.tgz
```

Database backup files are written to:

```text
/home/ecs-user/inspiration-diary-src/backups/prod-before-release-<timestamp>.dump
```

Restore source:

```bash
ssh ecs-user@223.6.255.128 \
  'cd /home/ecs-user/inspiration-diary-src &&
   tar -xzf backups/source-before-release-<timestamp>.tgz &&
   sudo systemctl restart inspiration-diary.service'
```

Restore database only when a database change must be rolled back:

```bash
ssh ecs-user@223.6.255.128 \
  'cd /home/ecs-user/inspiration-diary-src &&
   set -a && source .env.production && set +a &&
   pg_restore --clean --if-exists --no-owner --no-acl \
     --dbname "$DATABASE_URL" \
     backups/prod-before-release-<timestamp>.dump &&
   sudo systemctl restart inspiration-diary.service'
```
