# Run reminders and typed Discord IDs — design

Date: 2026-11-13

## Why

Parties set a time and then people forget to show up. The poster wants the app to nudge the
party shortly before the run, in the place the party already talks: the party chat (the forum
thread the app opens once the time is finalized). Members who sign up without linking Discord
can't be pinged today, because Discord only pings by numeric account ID and those accounts only
have a typed username. So registration will also collect a Discord user ID, and the app will
ping with it.

## Goals

1. The poster sets one or more reminders, each "N minutes / hours / days before" the run.
2. Each reminder posts in the party chat thread and pings every member the app can ping.
3. At the same moment, every party member gets an in-app (bell) notification.
4. New accounts must enter their Discord user ID at sign-up; existing accounts can add or change
   it in the profile dialog. Typed IDs are pinged like linked ones.

## Non-goals

- No reminders for flexible posts (no finalized time) or LFP posts.
- No reminders when the post has no party chat thread: the bell notification still goes out,
  but no other Discord channel is used as a fallback.
- No change to the existing weekly "it's time" message sent to the guild channel.
- No Discord bot, no member lookup by name.
- Typed IDs never sign anyone in and never count as a linked Discord account.

## Anti-goals (would be a failure even if it "works")

- A typed ID that lets someone sign in as, or block linking by, the real owner of that ID.
- Duplicate reminders for the same run (e.g. after a restart, or two workers).
- A backlog of stale reminders sent after downtime.
- Reminders for a post that was closed manually, deleted, or whose poster is banned/deleted.

## Part 1: typed Discord IDs

**Data.** New nullable unique column `User.typedDiscordId String? @unique`, separate from
`User.discordId` (which stays the verified, sign-in identity). Format: `/^[1-9]\d{16,19}$/` (the
same check `buildPartyThread` already uses), after stripping whitespace and invisible characters
as `discordUsernameField` does.

**Sign-up.** `signupBody` (shared by password and passkey sign-up) gains a required
`discordUserId` field. The sign-up form in `LoginDialog.tsx` gets a "Discord user ID" input
next to the Discord username, with help text: "In Discord, turn on Settings → Advanced →
Developer Mode, then right-click your name and choose Copy User ID."

**Profile.** `PATCH /auth/me` accepts `discordUserId` for unlinked accounts only (same rule as
the typed username: `DISCORD_LINKED` 400 for linked accounts). `ProfileDialog.tsx` shows the
field for unlinked accounts. Existing accounts without one are not forced to add it.

**Conflicts.** Refuse (409 `DISCORD_ID_TAKEN`, friendly message "That Discord ID is already
used by another account.") when the ID equals any user's `discordId` or another user's
`typedDiscordId`. The unique index backs this up; a P2002 maps to the same error.

**Linking.** When an account links Discord via OAuth (and when a new Discord account is
created via OAuth sign-in), in the same transaction: clear `typedDiscordId` on this account and
on any other account whose `typedDiscordId` equals the verified ID. The verified owner wins.

**Who sees it.** `MeDTO` includes the viewer's own typed ID. It is never sent to other users in
the web app. Admin's user list may show it (builder's call).

**Pinging.** One helper resolves a member's pingable ID: `discordId ?? typedDiscordId`, with a
flag saying whether it is verified. Used by:
- the party thread roster: linked → `<@id> (\`id\`)` as today; typed → `<@id> (unverified)`;
  neither → name plus the typed username as today.
- the new reminders.
- My call: also the existing weekly reminder recipients and request/accept pings, so a typed ID
  pings everywhere a linked one does. `allowed_mentions.users` always lists exactly the IDs
  meant to be pinged.

## Part 2: reminders

**Setting them.** On the post form (create and edit; `NewPostPage.tsx`), recruiting/carrying
posts get a "Reminders" section: rows of [number] [minutes | hours | days] "before the run",
with add/remove. My calls: at most 3 reminders; each between 5 minutes and 7 days; duplicates
collapsed; stored as whole minutes. Hidden for LFP. The section is available before the time is
finalized; reminders only take effect once it is.

**Data.** `Post.reminderOffsets Int[] @default([])` (minutes, sorted, unique). A new table
records what was sent, so nothing goes out twice:

```
model PostReminderSent {
  postId        String
  post          Post     @relation(..., onDelete: Cascade)
  offsetMinutes Int
  runAt         DateTime   // the scheduledAt this reminder was for
  sentAt        DateTime @default(now())
  @@id([postId, offsetMinutes, runAt])
}
```

Keying on `runAt` means a changed time or the next weekly occurrence gets its own reminders.

**Party chat thread ID.** The app must remember the thread it created. `HttpWebhookSender.send`
already uses `?wait=true`; it will return the response's `channel_id`, and on a successful
`post.party_thread` delivery the worker stores it in new column `Post.partyThreadId String?`.
Reopening a post clears it (alongside the existing `forumThreadRequested: false`). Moving the
party forum guild is already blocked once a thread is requested.

**Firing.** A new job (`RunReminderJob`, same shape as `WeeklyReminderJob`, every 30 s) finds
due reminders: posts whose time is finalized (`closed/finalized`, or weekly), not deleted, poster
not banned/deleted, `scheduledAt` in the future, and some offset where
`scheduledAt - offset <= now` with no `PostReminderSent` row for (post, offset, scheduledAt).
For each one, in one transaction:
1. Insert the `PostReminderSent` row (the unique key is the claim; a conflict means skip).
2. If the reminder is more than 15 minutes late (downtime, or the time was finalized after the
   reminder's moment had already passed), stop here: recorded, not sent.
3. Create an in-app notification (new kind `reminder`) for every member, poster included:
   "Reminder: {title or bosses} starts in {offset label}", linking to the post.
4. If `partyThreadId` is set and the forum guild is still usable, enqueue a
   `post.run_reminder` delivery to the guild's party forum webhook with `?thread_id=` the
   thread.

If several offsets are due at once (e.g. a run finalized 10 minutes out with 15 min and 1 hour
reminders), only the closest one is sent; the rest are recorded as skipped.

**The Discord message.** Built in `messages.ts` (user text through `neutralize`/`clip`):

```
⏰ **{title or bosses}** starts <t:{unix}:R> (<t:{unix}:F>)
{pings of pingable members}
Unpinged: {names of members with no ID}   ← only when there are any
Party details: {webOrigin}/posts/{id}
```

`allowed_mentions: { parse: [], users: [...] }`. The worker rebuilds the ping list at delivery
time from current members (as weekly reminders do) and drops the delivery if the post is no
longer active-finalized, its time no longer matches the stored `runAt`, or the run has started.

**Sending to a thread.** `WebhookSender.send` gains an optional `threadId`; the URL becomes
`${webhookUrl}?wait=true&thread_id=${threadId}`. A 404 for a deleted thread fails the delivery
as today and also clears `partyThreadId`, so later reminders go to the bell only.

**Weekly runs.** Nothing extra: `WeeklyReminderJob` already moves `scheduledAt` to next week,
which is a new `runAt`, so next week's reminders fire naturally. Old `PostReminderSent` rows can
be deleted once their `runAt` is more than a week past (the job does this cheaply each run).

**Post detail page.** Shows the post's reminders, e.g. "Reminders: 1 day and 15 minutes before".

## Constraints

- Prisma migration via `prisma migrate dev`; never reset the database.
- Existing tests keep passing; new behavior gets server tests (signup, profile, link clearing,
  job claiming/skipping/lateness, delivery to thread, thread ID capture) and web tests (sign-up
  field, profile field, reminders editor, detail display).
- README gets a short "Run reminders" and "Discord user ID" note.

## Left to the builder

- Exact UI layout and copy beyond what's above; the offset label wording ("1 hour", "2 days").
- Whether admin user views show the typed ID.
- Index choices for the reminder query.

## Risks to check while building

- Confirm that a webhook message with `thread_id` to an auto-archived (not locked) forum thread
  succeeds and unarchives it; if not, treat it like a missing thread.
- A typed ID is unverified: anyone can enter a stranger's ID. Damage is limited to pings in
  this guild's party threads, Discord only notifies members of that server, and the roster marks
  it "unverified".
