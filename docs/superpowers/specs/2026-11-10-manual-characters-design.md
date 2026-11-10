# Party Finder: Manual characters and a slimmer character

Date: 2026-11-10
Status: Approved

## 1. Intent

Some characters can't be found through Nexon's rankings. Challenger World is the known case, and Nexon can also be down. Today those players hit "No character found with that name." and can't add a character at all. They need to enter the character by hand.

The user also wants the character to be only about how strong it is. Bosses, play times and the note belong to the party post, which already has its own bosses, time and note. So those three things leave the character completely.

### Success looks like
- A player whose character Nexon can't find can still add it in under a minute and use it on posts like any other character.
- Adding a character asks only for strength and identity details. It doesn't ask for bosses, play times or a note.
- A manual character that Nexon later finds can be upgraded to a normal synced one without deleting and re-adding it.

## 2. Goals, non-goals, anti-goals

**Goals**
- **Manual path:** a manual way to add a character when the Nexon lookup finds nothing or fails.
- **Removed fields:** character bosses (with experience), play times and note are removed from the data, the API, the forms, the card and the detail popup.

**Non-goals**
- Uploading your own character image. Manual characters use one default image.
- Changing posts. Post bosses, time and note stay as they are.
- Adding new worlds. Challenger World must already exist as an active world in Admin.

**Anti-goals** (failure even if it technically works)
- A manual character that the daily sync or a refresh marks "stale" or overwrites with nothing.
- Manual characters that look broken on cards: a missing image or a grey frame because the class is unknown.
- Breaking existing synced characters, posts, lineups or member snapshots.

## 3. Decided by the user

- **When the manual option appears:** it appears when Find returns no match, or when Nexon can't be reached. It also appears under the results when Find returns characters that aren't the right one. The player enters name, world, class and level.
- **Default image:** one default character image is used for every manual character. The card frame is still colored by class.
- **Card note:** the card shows a small "Added manually" note.
- **Daily sync:** it skips manual characters.
- **Editing:** a manual character's class and level can be edited.
- **Refresh from Nexon:** this button works on manual characters too. If Nexon finds the character, it becomes a normal synced character with the real image, class and level.
- **Found on another world:** Challenger World characters move when the season ends. Heroic Challenger goes to a heroic world, and Interactive Challenger goes to an interactive world. Characters can also world-transfer. If Refresh from Nexon finds a manual character on a different world, a popup says the character was found on that world. The player can then update the character to it, which moves it to that world and makes it a synced character.
- **Removed from the character everywhere:** bosses, play times and note. Existing data is dropped.
- **Guild on a world move:** a character that moves worlds leaves its guild. The guild is cleared.
- **Admin-managed class list:** the class list starts as today's known classes. The admin can add and remove classes as Nexon releases new ones. Class lists always show in alphabetical order.
- **Required details:** a character, synced or manual, is name, world, class, level, combat power, guild and an optional Scouter screenshot.

## 4. Calls made in the conversation (*my call*, user didn't object)

- **Class:** chosen from a dropdown, not typed freely.
- **World:** chosen from the active worlds list.
- **Uniqueness:** the one-character-per-name-per-world rule stays. A manual character with the same name as a real one blocks the real one, and the admin can delete a fake.
- **Ownership:** like today, any logged-in user can add a manual character. There is no proof they own it. That matches the synced path, which also trusts the user.

## 5. Behavior details

### 5.1 Add character page
1. **Find:** the page starts with the IGN field and a Find button, as today.
2. **Manual entry offered:** the page shows an **Add it manually** button (secondary style) when:
   - the lookup returns no characters (shown with the "No character found" message);
   - the lookup fails with a network or Nexon error (shown with the error);
   - the lookup returns results that aren't the right character. The button sits under the previews, labelled something like "Not your character? Add it manually".
3. **Manual fields:** the button reveals a world select, a class select and a level number field (1–300). The IGN from the search box is prefilled and stays editable.
4. **Common form:** below that is the same form the synced path uses: combat power, guild and Scouter screenshot, then Save and Cancel.
5. **Synced path:** pick a preview, then fill combat power, guild and screenshot.

### 5.2 Edit character page
- **Synced characters:** edit combat power, guild and screenshot.
- **Manual characters:** also edit class and level. World and IGN are not editable, the same as today.

### 5.3 Server
- **New flag:** `Character.source` is either `nexon` or `manual`. Existing rows become `nexon`.
- **Create:** a manual create takes ign, worldId (active), jobName (must be a known class), level, combatPower, guildId (active), and sets `imageUrl` to the default image. It validates the same uniqueness rule. The server doesn't call Nexon on a manual create.
- **Update:** for manual characters, `jobName` and `level` can also be updated. Sending them for a nexon character is a 400.
- **Daily sync:** skips `source = manual`.
- **Refresh from Nexon** on a manual character:
  - It uses the same cooldown as today.
  - If Nexon finds the IGN in that character's world, the server sets `source = nexon` and copies the real level, class and image.
  - If Nexon doesn't find it anywhere it could be, the character stays manual and unchanged. It is **not** marked stale. The user sees "Still not found on Nexon".
  - If Nexon can't be reached, the character stays manual, unchanged and not stale. The user sees "Couldn't reach Nexon, try again later". The cooldown still counts, as it does today (*my call*).
  - **Found on another world:**
    - The server looks for exact-name matches on other **active** worlds of the **same world type** (heroic or interactive) as the character's current world.
    - It doesn't change the character. It answers "found elsewhere" with the candidate world(s) and each match's level, class and image.
    - The web shows a popup: "<IGN> was found on <World>. Update your character to it?" The popup offers **Update** and **Not now**. If several worlds match, the player picks one (*my call*).
    - **Update** calls a separate endpoint that re-runs the Nexon check for that world. It moves the character to that world (`worldId`), sets `source = nexon` and copies the real level, class and image.
    - The move is refused with a clear message if another character with that name is already registered on the target world (the uniqueness rule).
    - The move is also refused if the character is in a live post (open or full, not deleted, not expired), or has pending join requests or invites. The message is "Leave or close your open parties first". This keeps a post on one world from holding a character from another (*my call*).
    - **The guild is cleared** (user decision: a character has to leave its guild when it changes worlds). `Character.guildId` becomes nullable for this.
      - The popup also offers an optional **New guild** select (active guilds), so the player can pick one in the same step, or leave it as "No guild" (*my call*).
      - A character with no guild shows "No guild" on its card and in the popup.
      - It can't create a post, request to join or be invited until it has a guild. The server returns a clear 400 ("Pick a guild for this character first"). Posts and pings take their guild from the character, so they need one (*my call*).
      - The edit page lets the player pick a guild again.
      - New characters, manual or synced, still need a guild when they are created. Existing posts and member snapshots keep the guild they recorded.
  - **Synced characters:** world moves apply only to manual characters. Synced characters keep today's behavior: same world only, otherwise marked stale.
- **Removed fields:** the `CharacterBoss` table, `Character.playTimes` and `Character.note` are dropped by a migration, along with them in the DTOs, validation and serializer. The admin catalog's "is this boss in use" checks no longer count character bosses.

### 5.4 Class list (admin-managed)
- **Table:** a new `JobClass` table holds `name` (unique, case-insensitive) and `archetype` (warrior / magician / bowman / thief / pirate / xenon). The archetype drives the card frame color and the Characters page class filter. It is seeded, idempotently, from today's list in `shared/src/archetype.ts`.
- **Admin page:** a new **Admin -> Classes** page, built like the other catalog admin pages and admin-only.
  - It lists the classes alphabetically.
  - The admin adds a class by entering its name and picking its archetype, and can remove a class. Changing a class's archetype is also allowed (*my call*: it fixes a wrong pick without remove-and-re-add).
- **Public list:** a public `GET /api/classes` endpoint lists classes alphabetically. The manual add/edit dropdown uses it.
- **Removing a class:** it only stops the class being offered for new manual entries. Existing characters keep their class text and their frame color (*my call*). Their archetype falls back to the shared list, then "unknown".
- **Frame color:** the frame color uses the database list, so a newly added class gets its color without a code change. The server includes `archetype` in the character DTO, and the card and filter use that instead of calling `classToArchetype` on the client.
  - A synced Nexon character whose class isn't in the list shows the neutral frame until the admin adds that class.
- **Manual characters:** for a manual create or edit, `jobName` must be a class in the list.

### 5.5 Display
- **Default image:** it is a static asset in the web app. Its URL is stored in `imageUrl`, so snapshots, lineups and Discord messages keep working.
- **Card and popup:** they show "Added manually" for manual characters. The popup no longer has the Bosses, Play times or Note sections.
- **Lineups:** cards in post lineups lose their boss experience badges (learning / cleared / can carry), because that data is gone.

## 6. Constraints

- **Stack:** the existing Prisma migration flow. The migration is non-destructive to other tables, and dropping the three character fields is intended.
- **Tests:** all existing tests keep passing, updated only where the removed fields or the new form change them. Add tests for:
  - manual create
  - validation (unknown class, inactive world, duplicate)
  - the sync skip
  - refresh upgrading a manual character
  - refresh-not-found not marking it stale
  - class/level editing for manual characters only
  - the add page's manual path, for no results, a lookup error and wrong results
  - the class list: admin add, remove and archetype change (401/403 for non-admins); the alphabetical order; the archetype from the database driving the DTO
  - finding a character on another world: candidates limited to the same world type and active worlds; the move refused for a duplicate name or a live post or request; the popup flow on the web
- **Accessibility and layout:** keyboard and screen-reader access stay as they are. The page works at phone width (375px).

## 7. Left to the builder

- The default image itself. A simple neutral silhouette SVG or PNG that fits the card art area is fine.
- The exact field name and enum (`source`) and how the DTO exposes it, for example `manual: boolean`.
- Where the "Added manually" note sits on the card.
- How the class dropdown is grouped or sorted.
