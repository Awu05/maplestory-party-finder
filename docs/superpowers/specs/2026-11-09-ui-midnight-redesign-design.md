# Party Finder — "Midnight" UI Redesign

Date: 2026-11-09
Status: Draft for review

## 1. Intent

The web app works but looks dated, and the user dislikes the current brown/orange color scheme. Buttons and sections sit too close together. This redesign gives the whole app a modern, game-launcher feel (the user compared it to Discord) and makes the Board, the home page, faster to use.

**Mockups the user picked from** are in `.superpowers/brainstorm/*/content/visual-style.html`, option A "Midnight", and `board-layout.html`, option 3 "List + preview". These files are git-ignored scratch, so treat this document as the source of truth.

### Success looks like
- Every page uses one consistent dark navy look with violet and cyan accents. No brown or orange remains.
- Nothing feels cramped: buttons in a row have clear gaps, and titles, actions and content have breathing room.
- On the Board, a player can click through posts and see each party's lineup and join button without leaving the page.

## 2. Goals, non-goals, anti-goals

**Goals**
- A new color system ("Midnight") applied app-wide.
- A consistent spacing scale, and consistent button styles.
- Filters on the Board become chips instead of native dropdowns and checkboxes.
- A two-pane Board: a post list on the left and a preview of the selected post on the right.
- Header tweak: the notification bell moves before the user's Discord name.

**Non-goals**
- Redesigning the Pokémon-style character cards. The user said to keep them for now: class-colored frames, rarity finishes and holo shine all stay. Only the app-level surface colors they inherit change.
- Changing any behavior, data or server API. This is presentation only, plus the Board's preview pane, which reuses existing data and actions.
- A light mode (see §4).
- New fonts or icon libraries.

**Anti-goals** (failure even if it technically works)
- Losing functionality or accessibility that exists today. Keyboard use, focus outlines, aria labels and phone layout must all still work.
- A half-migrated app, where some pages still show the old brown palette or the old cramped spacing.
- Low-contrast text. Body text on navy must stay comfortably readable (aim for WCAG AA).

## 3. Visual system (decided)

### 3.1 Colors (from the chosen mockup)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0f1220` | page background |
| `--surface` | `#151a2e` | panels, cards, header, list rows |
| `--surface-2` | `#1c2240` | chips, inputs, hover states |
| `--border` | `#232a45` (stronger: `#2a3360`) | panel and chip borders |
| `--text` | `#e6e8f2` | main text |
| `--muted` | `#8d93b3` | secondary text and meta |
| `--accent` | `#8b7cff` (violet) | selected chip, links, focus, active nav |
| `--accent-2` | `#4fd1ff` (cyan) | "Recruiting" tag, party-fill bars, secondary highlights |
| `--gradient` | `linear-gradient(90deg, #8b7cff, #4fd1ff)` | primary buttons |
| `--danger` | builder's call: a red that reads well on navy | Delete, Ban, errors |

- **Type tags:** "Recruiting" uses cyan text on a translucent cyan background. "Looking" uses light violet (`#b3a9ff`) on a translucent violet background.
- **Status pills** (Open / Full / Closed / Deleted) are re-tinted to fit. Builder's call on exact tints.

### 3.2 Buttons (*my call*)
- **Primary:** gradient fill with dark text (`#0f1220`). Use it for the main action on a page: New post, Request to join, Save, Add character.
- **Secondary:** subtle outline on the surface color. Use it for Edit, Refresh from Nexon, Cancel, Renew, Close.
- **Danger:** red outline that fills on hover. Use it for Delete, Ban, Remove, Delete permanently.
- All buttons get the same height, padding and corner radius (about 8px). Hover and focus states are visible.

### 3.3 Spacing (user's ask)
- Use a single spacing scale, for example 4/8/12/16/24/32px as CSS variables, everywhere instead of ad-hoc values.
- **Buttons in a row** get at least an 8px gap.
- **Action groups**, such as the buttons under a character card or post actions, sit in a wrapping row with a 12px gap and space above them.
- **Pages:**
  - A page title is followed by its main action and content, with clear vertical space between them.
  - Content sits in a centered column with comfortable side padding.
  - Grids of cards get even gaps.
- **Forms:** more space between fields.

### 3.4 Typography (*my call*)
- Keep the system font stack and set a clear scale for page titles, section headings, body text and meta text.
- The app name in the header renders as "Party**Finder**", with "Finder" in violet.

### 3.5 Theme mode (*my call*)
The site is always Midnight dark. Today it follows the device's light or dark setting (`prefers-color-scheme`); that switch goes away. The card colors in `card.css` that depend on dark mode should look right on navy.

## 4. Layout changes (decided)

### 4.1 Header
- **Left:** brand, then nav links (Board, Characters, My parties, My characters, Admin). The active link is brighter and bolder.
- **Right:** the notification bell first, then the avatar and Discord name, then Log out. This swaps the bell to sit before the name, as the user asked.
- Phones keep the existing collapsing menu behavior.

### 4.2 Board: list + preview
- **Filter chips** above the list:
  - Type: All / Recruiting / LFP.
  - World chips: multi-select, defaulting to the viewer's worlds as today.
  - When: Any / Next 24h / This week / Flexible.
  - Boss, Difficulty and Guild: each is a chip that opens a small menu. Builder's call on the exact control, but it must be keyboard accessible.
  - The "New post" primary button sits at the right of the title row.
- **Left pane, the post list.** Each row is compact and shows:
  - the type tag;
  - the boss labels;
  - the time;
  - the poster's IGN or guild;
  - for Recruiting posts, slots `2 / 4` with a cyan fill bar.
  - The selected row is highlighted with violet. Keyboard up and down moves the selection; that part is the builder's call.
- **Right pane, the preview** of the selected post:
  - title (bosses), time, world and guild, minimum CP and note;
  - the party lineup as small character thumbnails with dashed "open slot" placeholders;
  - the viewer's actions: Request to join, Invite, Cancel request, Accept/Decline for received invites, and Edit for their own post. These reuse the existing components and hooks.
  - A link opens the full post page.
  - The first post is selected by default. The selected post id is kept in the URL (for example `?post=<id>`) so reloading keeps the selection.
- **Phones (≤ 640px):** only the list shows, and tapping a row goes to the full post page `/posts/:id`.
- **Unchanged:** the full post page stays for shared links and the post's own controls.

### 4.3 Everything else
These pages get the new colors, spacing, buttons and chips with no structural change:
- Characters, My characters, the character form
- New/edit post and the post detail page
- My parties
- The notification dropdown
- All admin pages

Native `<select>` and checkbox controls elsewhere may stay native but must be styled to match. Builder's call where chips fit better, for example the admin status filter.

### 4.4 Board details (*my calls*, settled after review)
- **Preview data:** the preview fetches the selected post's detail through the existing `GET /api/posts/:id` endpoint (`usePost`). No API or DTO change is needed. Show a loading state and an error state. The existing query invalidation after join, accept and similar actions keeps it fresh.
- **Shared actions:** extract the viewer actions out of `PostDetailPage.tsx` so the full page and the preview share them. That covers request to join, invite, cancel, accept/decline for received invites, and the character pickers.
  - The preview shows the viewer's actions plus an **Edit** link for your own post.
  - Poster management (Close, Renew, Delete, applicants and removing members) stays on the full post page, reached through "Open post".
- **Selection and the URL:**
  - The first post is selected by default. `?post=<id>` is kept with `replace` navigation, not push.
  - If the id in the URL isn't in the current list (a stale link, or the post was filtered out, closed or deleted), select the first listed post and rewrite the URL.
  - The other filters stay out of the URL.
- **Empty and loading states:**
  - With no results, keep the "No open posts match. Be the first to post!" text in the list area. The preview shows a quiet placeholder: "Pick a post to see its party".
  - Show a simple loading state (skeleton rows or a spinner).
- **List rows:** compact, with a small poster sprite thumbnail like the mockup instead of the full trading card. Show the type tag, bosses, time, poster IGN or guild, and for Recruiting posts the slots plus a fill bar.
  - The poster appears in the preview lineup, since the poster is a member.
  - `PostCard` stays for the other places that use it, such as My parties.
- **Phone vs. desktop:**
  - Use a `matchMedia('(max-width: 640px)')` hook.
  - On desktop, clicking a row selects it. On phones, rows navigate to `/posts/:id`.
  - Rows are real links either way, so middle-click and open-in-new-tab work.
  - Keyboard: the list is a listbox-style group with a single Tab stop, Up/Down to move the selection, and Enter to open the full post.
- **World chips:** one chip per active world, multi-select. They start pre-selected to the viewer's worlds, as today. Deselecting every chip means all worlds. There is no separate "All" chip.
- **Boss, Difficulty and Guild chips:** each is a disclosure button that opens a keyboard-accessible list. Difficulty is disabled until a boss is picked.
- **Contrast:** the builder may nudge token values slightly, especially `--muted` and the accent-colored text, so text passes WCAG AA on the surfaces it sits on. Keep the same hues.
- **Character cards:** change only the tokens they inherit, and drop their `prefers-color-scheme` branch so they always use the dark-mode values. Leave frames, rarity finishes and holo shine as they are.
- **Existing tests** that query the old `<select>` and checkbox filters get rewritten to use the chips' roles.

## 5. Constraints

- **Stack:** React 18 + TypeScript + plain CSS (no CSS framework). Keep the existing approach of tokens on `:root` in `web/src/styles/global.css`, plus per-area CSS files.
- **No behavior regressions:** all existing web tests keep passing. Tests may be updated only where markup changes legitimately, such as filters becoming chips. Add tests for:
  - the Board list + preview: selection, URL param, actions in the preview, and phone fallback;
  - the header order.
- **Accessibility:** focus outlines stay visible, chip groups are keyboard-operable with correct roles (toggle buttons or radio groups), and contrast is at least AA for body text.
- **Phone width:** every page works at 375px.

## 6. Left to the builder

- The exact CSS variable names beyond the table above, and how CSS is split across files.
- The menu control used for the Boss, Difficulty and Guild chips.
- Exact tints for status pills, the danger color, hover and active states.
- Small visual polish: shadows, subtle glows, transition timing.
- Whether to extract shared UI primitives (Button, Chip, Panel) as components or keep them as CSS classes.
