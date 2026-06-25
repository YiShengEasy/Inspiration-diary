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

## Run Production With Docker

This starts the production build in Docker and reads database/runtime settings from `.env.production`:

```bash
npm run docker:prod
```

After it starts, open:

```text
http://localhost:3005
```

Run in the background:

```bash
npm run docker:prod:detached
```

Stop the production containers:

```bash
npm run docker:prod:down
```

Useful Docker checks:

```bash
docker compose ps
docker compose logs -f app
```

The Docker app reads runtime configuration from `.env.production`. Mock data tools are disabled in the production Docker build by default.

If the configured PostgreSQL database is running on this Mac, use `host.docker.internal` as the database host in `.env.production` because `localhost` inside Docker points to the container itself.

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

New image uploads are stored in PhotoPrism. PostgreSQL stores only URL metadata for each inspiration card.

Required production environment variables in `.env.production`:

```env
PHOTOPRISM_INTERNAL_URL=http://host.docker.internal:2342
PHOTOPRISM_PUBLIC_URL=http://localhost:2342
PHOTOPRISM_USERNAME=admin
PHOTOPRISM_PASSWORD=<server-side-secret>
```

`PHOTOPRISM_INTERNAL_URL` is used by the Docker app container to upload images. `PHOTOPRISM_PUBLIC_URL` is used in saved image URLs rendered by the browser.

After changing PhotoPrism settings, rebuild the production container:

```bash
npm run docker:prod:detached
```
