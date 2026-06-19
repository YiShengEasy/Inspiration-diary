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
