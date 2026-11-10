# Party Finder: Free times on posts, finalized later

Date: 2026-11-10
Status: Approved

## 1. Intent

Making a post today means picking one exact date and time, or ticking Flexible. That's not how bossing gets planned. The poster knows when they're usually free, and the real time is agreed once the party has formed.

So a post now lists the hours the poster is free, picked on the old weekly days × hours grid. Later, the poster of a Recruiting post finalizes one exact date and time for the party.

### Success looks like
- Making a post takes a few clicks on a grid instead of a date picker.
- Anyone browsing can see when the poster is free, in their own time zone.
- Once the party exists, the poster sets the real time in one step, and the party hears about it.

## 2. Goals, non-goals, anti-goals

**Goals**
- **Free-time grid:** the post's "When" becomes the weekly free-time grid. The single date and time picker and the Flexible checkbox are removed from the post form.
- **Finalize time:** a **Finalize time** button and popup let the poster of a Recruiting post set, or later change, the exact date and time.
- **Board filter:** the Board's When filter fits the new model, and a new **Free at** filter is added.

**Non-goals**
- Members proposing or voting on times.
- Recurring or calendar-synced events.
- Changing how expiry works beyond what §5.3 says.

**Anti-goals** (failure even if it technically works)
- Times shown in the wrong time zone, or shifted by a day.
- Existing posts losing their time or disappearing from the Board after the change.
- A finalized time that the party never finds out about.

## 3. Decided by the user

- **What the grid means:** the times on a post are when the poster is free. The time can be finalized later, once the party is formed.
- **Finalizing:** a **Finalize time** button on the post opens a popup where the poster picks a date and time.
- **Agreed in the playback:**
  - The grid is the old one: days of the week across, hours down, click or drag to select, shown in each viewer's time zone.
  - An empty grid means Flexible / any time.
  - After finalizing, the post shows the final time with the free-time grid still below it.
  - Party members are notified, in the app and by a Discord ping.
  - The poster can change the final time later through the same popup.
  - Only Recruiting posts get Finalize, at any time, whether or not the party is full. LFP posts only show the grid.
  - **Expiry:** a post with no final time expires 7 days after it's posted or renewed, as Flexible does today. Once finalized, it expires based on the final time, as scheduled posts do now.
  - **Board:**
    - **Next 24h** and **This week** match finalized times only.
    - A new **Free at** filter picks a day and hour.
  - **Existing posts:** a post with an exact time counts as finalized. A Flexible post becomes one with an empty grid.

## 4. Data and server (*my calls*)

- **Model:**
  - `Post.freeTimes Int[] @default([])` holds the poster's free hours as **local hour-of-week in the poster's own time zone** (0 = Sunday 00:00 … 167 = Saturday 23:00).
  - `Post.freeTimesZone String?` holds the poster's IANA time zone, e.g. `America/New_York`. The browser sends it from `Intl.DateTimeFormat().resolvedOptions().timeZone`, and the server validates it as a real zone. It is required whenever `freeTimes` is non-empty.
  - **Why (user decision):** storing fixed UTC hours would shift every hour by one for posts that span a daylight-saving change. Storing the poster's wall-clock hours plus their zone keeps "Tue 8pm" meaning 8pm for the poster in every week.
  - `Post.scheduledAt` stays, and now means **the final time**. Null means not finalized.
  - The migration only adds the columns, so existing data maps with no conversion.
- **Shared time helpers** in `shared/src/` (no new dependencies; use `Intl`):
  - `zonedToInstant(wall: { year, month, day, hour }, zone): Date` gives the instant when that wall-clock hour happens in `zone`. During the spring-forward gap it uses the next valid hour. During the fall-back overlap it uses the first occurrence.
  - `instantToZoned(date, zone): { year, month, day, hour, dayOfWeek }`.
  - `freeSlotsForViewer(freeTimes, posterZone, viewerZone, now): { day, hour }[]`. For each poster slot, it takes the slot's next occurrence on or after the start of the current week in the poster's zone, converts that instant to the viewer's zone, and returns the viewer's day/hour. The result is deduplicated and sorted.
  - The tests cover these at New York's spring and fall DST changes, at a half-hour zone (Asia/Kolkata, whose cells round down to the hour), and with poster zone equal to viewer zone (identity).
- **Create and edit:**
  - `POST /api/posts` and `PATCH /api/posts/:id` accept `freeTimes` (an array of unique ints 0–167, max 168) and `freeTimesZone`. They no longer accept `scheduledAt`.
  - An unknown zone, or a non-empty `freeTimes` with no zone, is a 400 `VALIDATION`.
  - Sending `scheduledAt` is ignored, because zod strips unknown keys.
  - An edit never touches the final time, with one exception: switching a finalized Recruiting post to LFP clears its final time and gives it the flexible expiry (LFP posts have no final time).
- **Finalize:** `PUT /api/posts/:id/final-time` with body `{ scheduledAt: ISO string }`.
  - **Who:** the poster only (403). Recruiting only, otherwise 409 `WRONG_POST_TYPE`.
  - **State:** the post must be open or full, not deleted and not expired (409 `POST_CLOSED`).
  - **Time window:** the time must fall within the existing schedule window, from 5 minutes ago to 30 days ahead (`assertScheduleWindow`).
  - **Effect:** it sets `scheduledAt` and `expiresAt = postExpiresAt(scheduledAt, now)`.
  - **Event:** it emits a new `post.finalized { postId }` domain event, both the first time and when the time changes.
- **Renew:** stays limited to posts with no final time, as it is today.
- **Notifications on `post.finalized`:**
  - In-app: every member except the poster gets a notification of a new kind `time_set`, reading "<poster IGN> set the time for <bosses>: <time>". The time is formatted in the viewer's time zone, the same way other times on the site are shown.
  - Discord: each member is pinged through their character's guild webhook, the same way accept pings work today, with a Discord timestamp `<t:unix:F>` so everyone sees their own local time. The existing ping rules apply: skip an inactive guild, a missing webhook, no guild, or the actor.
- **Board query:**
  - `when=next24h` and `when=week` keep filtering on `scheduledAt`, which now means finalized posts only.
  - `when=flexible` is relabeled "Not set" in the UI and means `scheduledAt` is null.
  - **A new `freeAt=<ISO instant>`** filter: the web sends the last minute of the next occurrence of the viewer's chosen day and hour as an instant (`freeSlotsForViewer` rounds a poster hour down into the viewer cell holding its start, so in half-hour zones only the cell's end falls in the poster hour shown there). The server keeps posts where `freeTimes` contains that instant's hour-of-week in **the post's own** `freeTimesZone`, computed in SQL as `EXTRACT(DOW FROM ts AT TIME ZONE zone) * 24 + EXTRACT(HOUR FROM ts AT TIME ZONE zone)`, for example as an id prefilter. It combines with the other filters.

## 5. Web (*my calls* unless marked)

### 5.1 Post form (new and edit)
- **When:** a "When you're free" grid replaces the date picker and the Flexible checkbox. The poster edits it in their own time zone; the form sends `freeTimes` as local hour-of-week plus `freeTimesZone`. The old `PlayTimeGrid` (deleted in the manual-characters work, recoverable from git `7a73ac3:web/src/components/PlayTimeGrid.tsx` and its CSS) comes back as `FreeTimeGrid`, with labels saying "free times" instead of "play times".
  - Empty is allowed, with the hint "Leave empty if you're flexible".
- **Edit:** the edit page edits the grid. Changing the final time happens only through Finalize.

### 5.2 Post page and Board preview
- **When section:**
  - With a final time: "Final time: <local date and time>". Without one: "Time not set yet".
  - Then the read-only free-time grid in the viewer's time zone (via `freeSlotsForViewer`), with the caption "Shown in your time zone (<zone>)", or "Flexible" when the grid is empty.
- **Finalize button:** shown to the poster of a live Recruiting post. It reads **Finalize time**, or **Change time** once set.
  - It opens a popup with a date-and-time input. It follows the focus and Escape pattern of `MoveWorldDialog`, including returning focus after close.
  - The popup has Save and Cancel.
  - Server errors show inside the popup.
- **Board list rows** (*my call*): the time column shows the final time if set. Otherwise it shows "Free times" when the grid has hours, or "Flexible" when it's empty.

### 5.3 Board filters
- **When chips:** Any / Next 24h / This week / Not set.
- **Free at** (a MenuChip-style control): pick a day (Sun–Sat) and an hour in the viewer's time zone. The web sends the last minute of the next occurrence of that viewer hour as `freeAt`, so it matches the poster hour the grid shows in that cell, even across half-hour zones. A clear option returns to "Any time".

### 5.4 Discord new-post message
- **"When" field:** a finalized post keeps today's Discord timestamp. Otherwise:
  - with free times, "Not set yet — see free times on the post";
  - with an empty grid, "Flexible".

### 5.5 Notification bell
- The new `time_set` kind renders like the other kinds and links to the post.

## 6. Constraints

- **Stack:** the existing stack and patterns. No new dependencies.
- **Migrations:** never `prisma migrate reset`.
- **Server time zone:** the server (the user's EST home server) must not affect behavior. Store and compare instants in UTC, and never use the server's local zone (no `new Date().getHours()`, `getDay()` or `getTimezoneOffset()` on the server). Postgres `AT TIME ZONE` and Node's full ICU `Intl` (default in Node 24) supply the zone data.
- **Tests:** existing tests keep passing, updated where the form and filters change. Add tests for:
  - freeTimes validation (out of range, duplicates);
  - the finalize rules (poster only, recruiting only, closed post, time window);
  - expiry after finalizing;
  - the `post.finalized` notifications and pings, including the skip rules;
  - the Board `freeAt` and Not set filters;
  - the grid on the form;
  - the Finalize popup;
  - the time helpers at the DST changes and a half-hour zone;
  - the `freeAt` filter for a post in a different zone from the viewer.
- **Accessibility and layout:** the grid is keyboard-usable (Enter/Space toggles a cell) and has a label. The page works at 375px; the grid may scroll sideways inside its own box.

## 7. Left to the builder

- Exact styling of the grid and the Finalize popup.
- The exact "Free at" control, as long as it is keyboard accessible.
- The notification copy beyond the sentence in §4.
