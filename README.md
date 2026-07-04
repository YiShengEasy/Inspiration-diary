<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/4fac7d8a-8766-4021-9c15-3411fbe6f652

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Docker Environments

Local Docker uses `.env.local` and `docker-compose.local.yml`. It is intended for development on this machine, keeps PhotoPrism available for primary image uploads, and stores video/image attachments on the local Docker volume:

```bash
cp .env.local.example .env.local
npm run config:local
npm run docker:local:detached
```

Local Docker should identify itself explicitly:

```env
APP_ENV=local
DEPLOYMENT_PROFILE=local-docker
```

After local Docker starts, open:

```text
http://localhost:3005
```

Production Docker uses `.env.production` and `docker-compose.production.yml`:

```bash
cp .env.production.example .env.production
npm run config:production
npm run docker:production:detached
```

The production target is an Alibaba Cloud ECS in Hangzhou with 2 vCPU, 2 GiB RAM, 40 GiB disk, and 3 Mbps fixed bandwidth. Keep this instance focused on the app, PostgreSQL, and the host reverse proxy. Do not run PhotoPrism in production on this ECS; production media should use Alibaba Cloud OSS so image and video traffic does not consume the ECS disk or bandwidth budget.

Production should identify itself explicitly:

```env
APP_ENV=production
DEPLOYMENT_PROFILE=production
```

Production storage settings should stay on OSS:

```env
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

Stop Docker containers:

```bash
npm run docker:local:down
npm run docker:production:down
```

Useful Docker checks:

```bash
docker compose -f docker-compose.local.yml ps
docker compose -f docker-compose.production.yml logs -f app
```

See [docs/deployment/alibaba-cloud-ecs.md](/Users/yisheng/Documents/SLUAN/Inspiration-diary/docs/deployment/alibaba-cloud-ecs.md) for the ECS deployment checklist, reverse proxy notes, and backup workflow.

## Local Authentication

The production app uses local PostgreSQL-backed users and server-side sessions. Register the first user from the login screen, or set `AUTH_BOOTSTRAP_EMAIL` and `AUTH_BOOTSTRAP_PASSWORD` before the first Docker start to create a local administrator account.

All card, note, settings, AI, upload, and photo proxy APIs require login. Sessions are stored in PostgreSQL and sent to the browser as an `HttpOnly` cookie named `inspiration_session`.

## Native WeChat Mini Program

The native mini program lives in `miniprogram/app`. Open that directory in WeChat Developer Tools.

Do not open `miniprogram/prototype` for native mini-program testing. That directory is the React/Vite visual prototype used as the design reference.

Local backend:

```bash
npm run docker:prod:detached
```

Smoke checks:

```bash
npm run auth:smoke
AUTH_SMOKE_BASE_URL=http://localhost:3000 npm run mini:auth:smoke
```

For local WeChat login testing, start a mock-enabled backend:

```bash
WECHAT_MOCK=true npm run dev
```

For normal local mini-program API calls, `miniprogram/app/app.js` defaults to the Mac LAN backend, for example `http://172.17.10.116:3005`, because `localhost` may point to the simulator or phone instead of the Mac. If your Wi-Fi IP changes, update the value in `app.js` or override it in DevTools console:

```js
wx.setStorageSync("apiBaseUrl", "http://YOUR_MAC_IP:3005")
```

For mock WeChat auth testing, set the mini-program `apiBaseUrl` to `http://localhost:3000` while the mock backend is running.

Keep `urlCheck` disabled in `miniprogram/app/project.config.json` for local development against local HTTP endpoints.

## PhotoPrism Image Storage

Local development can store primary image uploads in PhotoPrism. PostgreSQL stores only URL metadata for each inspiration card.

Local PhotoPrism environment variables in `.env.local`:

```env
PHOTOPRISM_INTERNAL_URL=http://host.docker.internal:2342
PHOTOPRISM_PUBLIC_URL=http://localhost:2342
PHOTOPRISM_USERNAME=admin
PHOTOPRISM_PASSWORD=<server-side-secret>
```

`PHOTOPRISM_INTERNAL_URL` is used by the Docker app container to upload images. `PHOTOPRISM_PUBLIC_URL` is used in saved image URLs rendered by the browser.

After changing local PhotoPrism settings, rebuild the local container:

```bash
npm run docker:local:detached
```

PhotoPrism is intentionally local-only. Production should not depend on PhotoPrism and should use OSS for primary images, videos, and image attachments.
