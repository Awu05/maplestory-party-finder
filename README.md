# Party Finder

Party finder for MapleStory bossing. Monorepo: `shared/` (types, TS source), `server/` (Fastify + Prisma), `web/` (Vite + React).

## Accounts and sign-in

- **Log in** offers Discord, **Log in with email**, and **Sign in with a passkey**. Account creation asks for a Discord username and display name, then a choice of passkey or email and password. Successful sign-in opens My characters.
- Passkeys require HTTPS in production (localhost works for development). Set `WEB_ORIGIN` to the site's stable public origin: passkeys are tied to its hostname. The database stores public keys and verification counters; private keys and device biometrics stay with the authenticator. Apply database migrations before running the updated server.
- Email/password accounts use case-insensitive email addresses and passwords of 15–128 characters, including spaces. Passwords are stored as individually salted scrypt hashes (`N=32768, r=8, p=3`), never plaintext. Hashing is asynchronous with at most two operations per process; excess requests receive a retry message. Password endpoints limit requests per IP and per email over ten minutes. Credentials and emails are excluded from public account responses.
- **Forgot password?** under email login sends a single-use link valid for 30 minutes. Only a hash of the token is stored; requesting another link replaces the previous one. Resetting signs the account out on every device and asks the user to log in again. Requests return the same message for known and unknown email addresses and are rate limited. Passkey-only and Discord-only accounts cannot be reset by email.
- Configure SMTP to enable reset emails; without it, the reset form explains that email is unavailable. Delivery uses a bounded, sequential in-memory queue so response timing does not reveal whether an account exists. Failed deliveries invalidate their token and log no addresses or links. Pending deliveries do not survive restarts; request another link if needed. SMTP delivery errors should be checked in the server logs.
- Signup does not verify email ownership. Users must use an email they control for recovery. Email, passkey and Discord accounts are never linked automatically (see **Linking Discord** below). A typed Discord username is unverified contact information; it never links an existing Discord account or grants admin access. These accounts receive in-app notifications but cannot receive direct Discord pings. Party forum rosters show their contact username instead of a Discord ID.
- **Unique Discord usernames.** Each Discord username belongs to one account, compared case-insensitively. Sign-up (and changing a typed name in **Profile**) is refused with "That Discord username is already in use." when another account holds it.
- **Real Discord wins.** Logging in with (or linking) the real Discord account takes its username from whichever account holds it. A typed name is cleared, and its owner sees "Discord name not set" until they enter a different name in **Profile** or link Discord; another Discord account's out-of-date name just gives up the claim and refreshes on its next Discord login.
- **Typed Discord usernames.** A name typed at sign-up or in Profile must follow Discord's own rule: 2 to 32 letters, numbers, dots or underscores. Leading `@` signs, spaces around the name and invisible characters are removed first, so lookalike names can't be used to get around uniqueness.
- **Linking Discord.** A passkey or email account can use **Profile → Link Discord account** to attach its Discord identity. The account keeps its id, characters, posts and passkeys; its name becomes verified, Discord pings work, and later Discord logins sign in to it. Accounts are never merged: if that Discord account already has its own Party Finder account, linking is refused and the user stays signed in to the account they started from.
- Discord sign-in still uses only the `identify` scope. It stores the Discord user ID, username and avatar URL, plus the app account creation timestamp and optional display name. The OAuth access token is used to fetch the profile and is not saved. The app does not request email, passwords, messages, friends or server membership. Normal server logs can contain request metadata such as IP addresses.

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
| `TRUST_PROXY` | Which reverse proxies may set `X-Forwarded-For`, so sign-in and other per-visitor limits see each visitor's real address. `false`, `true` (trust every hop), a hop count such as `1`, or comma-separated proxy IPs/CIDRs. Default when unset: if `WEB_ORIGIN` starts with `https://`, proxies on the same machine or a private network (loopback, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, link-local and the IPv6 equivalents) are trusted; otherwise `false`. A visitor connecting straight to the port from the internet is never trusted by default. Invalid values fail at startup. Only use `true` or a hop count when the port can't be reached except through your proxy: otherwise visitors can fake `X-Forwarded-For` and dodge the limits. |
| `PASSWORD_AUTH_ENABLED` | Set to `true` to offer email + password accounts (sign-up, login and reset by email). Default off: the login popup shows only Discord and passkeys, and the password routes don't exist. Turning it off later keeps existing password accounts in the database but they can't sign in with a password until it is back on. |
| `SMTP_HOST` / `SMTP_FROM` | SMTP server and verified sender email for password resets (only used when `PASSWORD_AUTH_ENABLED` is `true`); leave all SMTP settings blank to disable |
| `SMTP_PORT` / `SMTP_SECURE` | Default 587 with required STARTTLS; use `465` / `true` for TLS from connection start. Certificate verification stays enabled. |
| `SMTP_USER` / `SMTP_PASSWORD` | SMTP credentials; set both, or neither for a trusted relay |
| `ADMIN_DISCORD_IDS` | Comma-separated Discord IDs granted admin |
| `UPLOAD_DIR` | Where screenshots are stored. Every upload (PNG, JPEG or WebP, up to 5 MB) is decoded and redrawn as a fresh WebP of at most 2560 px, so hidden data and metadata (such as photo GPS) are thrown away. Images larger than about 40 megapixels are refused, and each user can upload 10 screenshots per 10 minutes. |
| `JOBS_ENABLED` | Run the webhook worker, daily sync and weekly party reminders in this process (default `true`; `false` or `0` disables, e.g. on a second instance) |
| `WEB_DIST` | Built web app dir; when set the server serves it (set automatically in the Docker image) |

## Discord channel setup

Guilds can post new parties and pings to a Discord channel through a webhook.

1. In Discord, go to Server Settings -> Integrations -> Webhooks -> New Webhook, pick the channel, and copy the webhook URL.
2. In the app, open Admin -> Guilds, paste the URL into the guild, then click Send test message.
3. Members must be in that Discord server for @mentions to work.
4. A guild can be selected for a post only if it is **active**, its **world list includes the post's world**, and the corresponding webhook is configured. The post's **Notification guild** receives announcements, direct party notifications and weekly reminders. A closure notice goes to the guild(s) whose channel actually received the announcement, even if the Notification guild has changed since. Changing the Notification guild drops messages still queued for the old one (they are not counted as failures). Nothing is broadcast to other guilds.
5. Links in Discord messages are built from `WEB_ORIGIN`, so set it to the public URL of the web app.
6. Admin -> Webhooks is the delivery health page (recent deliveries and failures); the Send test message button on Admin -> Guilds verifies a guild's webhook.
7. To notify boss roles on new posts, edit the guild in Admin -> Guilds and expand **Boss role pings**. Enter each boss's Discord role ID (enable Developer Mode in Discord, then right-click the role and Copy Role ID). Enable **Allow anyone to @mention this role** in Discord. All difficulties share the boss's role; each role is pinged once per new post. Leave a boss blank to skip its ping. Configure each guild's own role IDs; requests and accepts keep their direct user pings.
8. To create a discussion for finalized parties, create a separate Discord webhook whose channel is the parties **forum**, then paste its URL into **Party forum webhook URL** for that guild. The post's **Party chat guild** independently selects which guild's forum gets the thread. Each newly finalized party gets one forum post with bosses, host, time, member Discord IDs and party link. Changing the time does not create another thread; a requested chat cannot be moved by changing the selection. Picking a Party chat guild on an already finalized party requests its thread then. Reopening a party starts a new run, so its next finalize may request a new chat.

## Notifications & jobs

- The Board re-checks for new posts every 30 seconds and when you return to the tab. The in-app bell polls the server periodically for new notifications (join requests, invites, accepts, declines, removals from a party and members leaving); there is no push connection.
- A background worker delivers queued webhook messages every 5 seconds. Failed deliveries are retried with increasing delays (30 s, 2 min, 10 min, 1 h) and given up on after 5 attempts; Discord rate limits are respected.
- A daily sync refreshes every character from Nexon (skipping banned users' characters), oldest first, throttled. It checks hourly and runs when the last run was 24 hours ago or more, so the time of day drifts with the last run. It also prunes notifications older than 60 days and sent or failed deliveries older than 30 days.
- **Weekly parties:** in Finalize time (or Change time), check **Repeat weekly** to remind everyone currently in the party, including the owner, together in the selected **Notification guild** at the weekly start. The selected local day and time are saved with your time zone and follow daylight-saving changes. The party's next run advances automatically; turn off Repeat weekly or close/delete the party to stop it. The scheduler checks every 30 seconds; reminders use the existing webhook queue. On restart, occurrences more than 15 minutes late are skipped rather than sent in a backlog.
- Set `JOBS_ENABLED=false` to disable background jobs in a given instance.

## Posts & free times

- **Making a post.** Pick the times you're free in 30-minute increments on the weekly "When you're free" grid. Leave it empty if you're flexible. The grid's 12-hour/24-hour choice is remembered in your browser and also applies to the board's time filter.
- **Discord destinations.** New posts default to **None**. Choose notification and party chat guilds independently in the new/edit form or the post's Discord section; the character can be guildless. Choices show configured destinations for the character's world, without exposing webhook URLs. Saving a selection sends nothing and does not reset the announcement cooldown. Existing posts keep their own guild as a destination only when it has a matching configured webhook; other existing posts start with None. An unavailable destination is skipped instead of falling back to another server. Changing worlds clears the previous selections. Notification destinations can also be changed for active finalized parties.
- **Notify Discord again.** On an open post, the creator can use **Notify Discord** once every 24 hours, starting 24 hours after creation. It sends the announcement and configured boss-role pings only to the selected notification guild.
- **Party availability.** Accepted members can use **Edit my times** on the post to add or change their own availability. The legend identifies each member's color; stripes and a number show overlap, and a white outline marks a full half hour when everyone is free. Focus a cell to read who is available, including partial overlaps. The post view refreshes periodically to show other members' updates.
- **Time zones.** Availability is stored in each person's time zone and shown in the viewer's zone. Split cells show partial availability when zones differ by 15 or 45 minutes. Editing uses the saved zone when needed to avoid losing part of a selected time.
- **Finalize time.** The poster sets the time with **Finalize time** on the post page. This closes recruitment, removes the post from the board, and declines pending requests and invites. The party remains available to its members, and the poster can change the time or end it. Members get an in-app notification and a Discord ping showing the time in their own zone. A post with no final time expires 7 days after it's posted or renewed; once finalized it expires based on the final time.
- **Reopen a party.** The poster can reopen a closed or past party from its post page. The existing lineup and availability stay, the old final time and weekly reminders are cleared, and recruitment gets a fresh seven-day window. Reopening sends a Discord announcement with boss-role pings to the saved notification guild and starts a new 24-hour cooldown for Notify Discord. A full party returns to the board once a member leaves or is removed.
- **Board filters.** Free times: pick a day and half-hour to find posts whose poster is free for that entire half-hour; Reset clears it.
- **Discord new-post messages** show the final time, or "Not set yet — see free times on the post", or "Flexible".

## Characters

- **Display name.** Click your avatar or name in the header to open the Profile popup, where you choose a display name (up to 50 characters) or log out. Leave it blank to use your Discord username. Cards, party lineups and new Discord post messages use this name; character details still show your real Discord username for copying, and mentions still reach your Discord account.
- **Characters Nexon can't find.** If Nexon can't find a character (e.g. on Challenger World), is unreachable or returns the wrong character, Add character offers "Add it manually": enter name, world, class and level. Manual characters use a default image, show "Added manually", and are skipped by the daily sync; their class and level can be edited.
- **Refresh from Nexon on a manual character.** If Nexon now finds it on its own world, it becomes a normal synced character. If it is found on another active world of the same type (heroic/interactive), a popup offers to move it there. Moving clears the guild (or sets a newly picked one) and is refused while the character is in an open party or has pending requests/invites.
- **Guild is optional.** A character can be added without a guild (or have it cleared on its edit page), but it can't post, request to join or be invited until a guild is picked.
- Characters have no bosses, play times or note; those live on posts.
- **Admin -> Classes** includes all 54 classes from [Grandis Library](https://grandislibrary.com/classes), grouped into its 12 categories in both the admin view and character class dropdowns. Admins can change the category and archetype (warrior/magician/bowman/thief/pirate/xenon); archetype drives the card frame color. Classes are alphabetical within each category. Seeding preserves admin changes. Legacy Nexon names still resolve to the correct archetype without appearing as duplicate choices.

## Development

```
npm install
npm run dev:db                 # Postgres on localhost:5432
npm run db:setup -w server     # apply migrations + seed worlds, tiers, bosses (uses server/.env)
npm run dev -w server          # generates the Prisma client, then starts the API on :3000
npm run dev -w web             # Vite on :5173, proxies /api and /uploads to the server
```

`npm run db:setup` (root) does the same as `npm run db:setup -w server`; re-run it after pulling new migrations. It applies the migrations and the seed, which fills in existing characters' class type so card frames are colored. The Docker image runs this automatically on start.

The Prisma client is generated by `prisma generate` (npm blocks Prisma's postinstall). `npm run dev`, `npm test` and `npm run build` in `server/` run it automatically; run `npx -w server prisma generate` manually if your editor needs the types first.

## Tests

```
npm run dev:db
npm test
```

Server tests use the `partyfinder_test` database (migrated automatically).

Scouter screenshots are checked locally with bundled English OCR data before storage. Upload the full results with Boss Clear, combat stats, and Scouter Graph or Stat Efficiency visible. Cropped or unreadable images may be rejected. Each server process keeps one OCR worker process, started on the first upload and reused after that (it is restarted if it crashes or a check times out, and stopped on shutdown). It checks one upload at a time and queues up to 20 more in arrival order. Queued uploads wait at most 60 seconds; each active check has a separate 20-second deadline that does not include the worker's first start. A full queue asks the user to retry. Images are not sent to an external service. This checks screenshot text; it does not detect NSFW content or prove the image is authentic. Existing uploads are not rescanned.

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
