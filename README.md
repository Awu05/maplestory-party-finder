# Party Finder

Guild party-finder for MapleStory bossing. Monorepo: `shared/` (types, TS source), `server/` (Fastify + Prisma), `web/` (Vite + React).

## Discord application

1. Create an application at https://discord.com/developers/applications.
2. Under OAuth2, add the redirect URI `<origin>/api/auth/discord/callback` (e.g. `http://localhost:3000/api/auth/discord/callback`).
3. Scope used: `identify`.
4. Copy the client ID and secret into your `.env`.

## Environment variables

Copy `.env.example` to `.env` (root, used by Docker) or `server/.env` (dev).

| Variable | Purpose |
| --- | --- |
| `PORT` | Server port, 1-65535 (default 3000 when unset or blank; anything else fails at startup) |
| `DATABASE_URL` | Postgres connection string |
| `SESSION_SECRET` | Cookie encryption secret, at least 32 characters |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | Discord OAuth credentials |
| `DISCORD_REDIRECT_URI` | Must match the redirect URI registered with Discord |
| `WEB_ORIGIN` | Public origin of the site (https enables secure cookies) |
| `ADMIN_DISCORD_IDS` | Comma-separated Discord IDs granted admin |
| `UPLOAD_DIR` | Where screenshots are stored |
| `JOBS_ENABLED` | Run the webhook worker and daily sync in this process (default `true`; `false` or `0` disables, e.g. on a second instance) |
| `WEB_DIST` | Built web app dir; when set the server serves it (set automatically in the Docker image) |

## Discord channel setup

Guilds can post new parties and pings to a Discord channel through a webhook.

1. In Discord, go to Server Settings -> Integrations -> Webhooks -> New Webhook, pick the channel, and copy the webhook URL.
2. In the app, open Admin -> Guilds, paste the URL into the guild, then click Send test message.
3. Members must be in that Discord server for @mentions to work.
4. A guild only receives new-post messages if it is **active** and its **world list includes the post's world**. A guild with no worlds never gets new-post broadcasts (pings for requests and accepts still go to it).
5. Links in Discord messages are built from `WEB_ORIGIN`, so set it to the public URL of the web app.
6. Admin -> Webhooks is the delivery health page (recent deliveries and failures); the Send test message button on Admin -> Guilds verifies a guild's webhook.

## Notifications & jobs

- The in-app bell polls the server periodically for new notifications (join requests, invites, accepts, declines, removals from a party and members leaving); there is no push connection.
- A background worker delivers queued webhook messages every 5 seconds. Failed deliveries are retried with increasing delays (30 s, 2 min, 10 min, 1 h) and given up on after 5 attempts; Discord rate limits are respected.
- A daily sync refreshes every character from Nexon (skipping banned users' characters), oldest first, throttled. It checks hourly and runs when the last run was 24 hours ago or more, so the time of day drifts with the last run. It also prunes notifications older than 60 days and sent or failed deliveries older than 30 days.
- Set `JOBS_ENABLED=false` to disable both jobs in a given instance.

## Characters

- **Characters Nexon can't find.** If Nexon can't find a character (e.g. on Challenger World) or is unreachable, Add character offers "Add it manually": enter name, world, class and level. Manual characters use a default image, show "Added manually", and are skipped by the daily sync; their class and level can be edited.
- **Refresh from Nexon on a manual character.** If Nexon now finds it on its own world, it becomes a normal synced character. If it is found on another active world of the same type (heroic/interactive), a popup offers to move it there. Moving clears the guild (or sets a newly picked one) and is refused while the character is in an open party or has pending requests/invites.
- **Guild required.** A character with no guild can't post, request to join or be invited until a guild is picked on its edit page.
- Characters have no bosses, play times or note; those live on posts.
- **Admin -> Classes** adds and removes classes and sets each class's type (warrior/magician/bowman/thief/pirate/xenon), which drives the card frame color. Lists are alphabetical. It is seeded with the known classes.

## Development

```
npm install
npm run dev:db                 # Postgres on localhost:5432
npm run db:setup -w server     # apply migrations + seed worlds, tiers, bosses (uses server/.env)
npm run dev -w server          # generates the Prisma client, then starts the API on :3000
npm run dev -w web             # Vite on :5173, proxies /api and /uploads to the server
```

`npm run db:setup` (root) does the same as `npm run db:setup -w server`; re-run it after pulling new migrations. After pulling the manual-characters change, re-run it: it applies the migrations and the seed, which fills in existing characters' class type so card frames are colored. The Docker image runs this automatically on start.

The Prisma client is generated by `prisma generate` (npm blocks Prisma's postinstall). `npm run dev`, `npm test` and `npm run build` in `server/` run it automatically; run `npx -w server prisma generate` manually if your editor needs the types first.

## Tests

```
npm run dev:db
npm test
```

Server tests use the `partyfinder_test` database (migrated automatically).

## Run the whole app in Docker

```
cp .env.example .env      # fill in secrets; set WEB_ORIGIN=http://localhost:3000
docker compose up -d --build
```

This builds the web app and server into one image and serves both on http://localhost:3000, with Postgres alongside (also published on :5432 so local tools and tests can reach it). It shares the database with `npm run dev:db`. Set `DISCORD_REDIRECT_URI=http://localhost:3000/api/auth/discord/callback` in `.env` and add the same URL to your Discord application's redirects.

## Production

```
cp .env.example .env      # fill in secrets; WEB_ORIGIN / DISCORD_REDIRECT_URI use your public origin
docker compose -f docker-compose.prod.yml up -d --build
```

Same image as above, but the database port is not published and the data volumes are separate (project `party-finder-prod`).

## Releases

Pushing a version tag runs the tests on GitHub Actions and, if they pass, builds the Docker image and publishes it to GitHub Container Registry:

```
git tag v1.0.0
git push origin v1.0.0
```

The image is `ghcr.io/awu05/maplestory-party-finder`, tagged `1.0.0`, `1.0`, `latest` and the commit SHA (see `.github/workflows/release.yml`). A pre-release tag such as `v1.1.0-rc.1` publishes only `1.1.0-rc.1` and the SHA; it never moves `latest` or `1.1`. It is built for both `linux/amd64` and `linux/arm64`, so `docker pull` picks the right one for x86 servers and ARM machines (Raspberry Pi, ARM cloud VMs) automatically. The workflow can also be run by hand from the Actions tab. The first published package is private; make it public under the repo's Packages settings if your server should pull it without logging in (`docker login ghcr.io` otherwise).

The app container applies migrations, seeds worlds, rarity tiers and bosses (idempotent, existing rows are not overwritten), then serves the API and web app on port 3000. Data lives in the `pgdata` and `uploads` volumes. Seeded worlds are best-known values. A world's name, type and active flag can be edited in the admin UI, but its Nexon world ID cannot: if a seeded ID is wrong, deactivate that world and add a new one with the correct ID.
