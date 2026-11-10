# Midnight UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the whole web app in the "Midnight" look, which has:
- dark navy backgrounds with violet and cyan accents,
- a consistent spacing scale and button styles,
- chips in place of native filters,
- the bell moved before the user's name in the header,
- the Board turned into a list plus a preview pane.

**Architecture:** The look is driven by CSS tokens in `web/src/styles/global.css`.
- **Tokens and primitives:** global.css holds the tokens, spacing scale and base classes (buttons, chips, panels, form controls).
- **Shared components:** a few small UI components in `web/src/components/ui/` (chip group, toggle chip, menu chip) plus a `useMediaQuery` hook.
- **Board:** composed from a new `PostRow` list and a `PostPreview` pane. The preview reuses the existing `usePost` detail query and the viewer-action components, which are extracted from `PostDetailPage`.
- **No server changes.**

**Tech Stack:** React 18, TypeScript, React Router 6, TanStack Query 5, plain CSS, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-09-ui-midnight-redesign-design.md`

## Global Constraints

- **Tokens:** values come from spec §3.1. `--bg #0f1220`, `--surface #151a2e`, `--surface-2 #1c2240`, `--border #232a45`, `--border-strong #2a3360`, `--text #e6e8f2`, `--muted #8d93b3`, `--accent #8b7cff`, `--accent-2 #4fd1ff`, `--gradient linear-gradient(90deg,#8b7cff,#4fd1ff)`. You may nudge values only to pass WCAG AA (spec §4.4). Keep the same hues.
- **Always dark:** remove both `prefers-color-scheme` blocks. The card dark-mode values become unconditional.
- **Spacing:** use only the scale `--space-1 4px`, `--space-2 8px`, `--space-3 12px`, `--space-4 16px`, `--space-5 24px`, `--space-6 32px`. Buttons in a row get at least an 8px gap. Action groups get a 12px gap.
- **Buttons:** `.btn` is the base class with modifiers `--primary` (gradient, text `#0f1220`), `--secondary` (outline on surface) and `--danger` (red outline, filled on hover). A bare `<button>` looks secondary, and the existing `a.button` looks primary.
- **Text:** keep the system font stack. The brand renders as `Party<span>Finder</span>`, with "Finder" in violet.
- **Header (right side):** bell, then avatar + Discord name, then Log out.
- **Board:** list plus preview on screens wider than 640px. At 640px and below, list only, and rows navigate to `/posts/:id`.
- **Board selection:** `?post=<id>` with replace navigation. An id that isn't in the list falls back to the first row.
- **Board world chips:** pre-selected to the viewer's worlds; none selected means all worlds; no "All" chip.
- **Boss/Difficulty/Guild chips:** these are disclosure menus. Difficulty is disabled until a boss is chosen.
- **Character cards:** keep their design. Change only the tokens they inherit and remove the dark-mode media query.
- **Behavior:** nothing changes. Existing tests stay green except where markup legitimately changes (filters). Every page works at 375px.
- **Old palette:** none of these hexes may remain anywhere in `web/src`: `#fff8ec #fbe3b5 #3b2a1a #7a6650 #e6d5b8 #c2570c #1c1610 #2a2118 #f3e6d0 #b49e80 #4a3b2a #f08a3c #33261a`.

## Review Focus

1. **Keyboard users on the new chips and the board list.** Every chip and menu is operable with Tab, Enter, Space and the arrow keys, with visible focus. (Tests in Task 3 and Task 6.)
2. **A stale or shared `?post=` link.** It falls back to the first post without a crash or blank preview. (Test in Task 6.)
3. **Phone width.** The Board shows no preview pane, and rows open the full post page. (Test in Task 6.)
4. **Contrast.** Body text, muted text and button text pass AA on their surfaces. (Test in Task 1.)
5. **Shared action components.** After extraction, Request, Invite, Cancel and Accept still work from both the full post page and the preview. (Tests in Task 5 and Task 7.)

---

### Task 1: Tokens, base styles, contrast test

**Files:**
- Modify: `web/src/styles/global.css` (rewrite the tokens, remove the dark-mode block, add the spacing scale, `.btn` variants, `.chip`, `.panel`, form control styling, and focus styles), `web/src/components/card/card.css` (make the dark-mode block unconditional)
- Create: `web/test/contrast.test.ts`

**Interfaces:**
- Produces:
  - **CSS variables:** the variables in Global Constraints, plus `--danger`, `--radius` (8px) and `--radius-lg` (12px).
  - **Classes:** `.btn`, `.btn--primary`, `.btn--secondary`, `.btn--danger`, `.chip` (selected state through `[aria-pressed="true"]` or `[aria-checked="true"]`), `.panel`, `.actions` (a wrapping flex row with a 12px gap), `.page` (centered column with side padding), `.page__head` (title row with the primary action on the right, `--space-5` below).
  - **Native controls:** `input`, `select`, `textarea` and checkboxes are styled to match (dark surface-2, border, focus ring in `--accent`).

- [ ] **Step 1: Write the failing test.** `contrast.test.ts` reads `src/styles/global.css` with `fs`, parses the `:root` custom properties with a small regex, and computes WCAG contrast ratios. Assert ≥ 4.5 for:
  - `--text` on `--bg`, `--surface` and `--surface-2`
  - `--muted` on `--bg`, `--surface` and `--surface-2`
  - `#0f1220` on both gradient endpoints (`--accent`, `--accent-2`)
  - `--accent` on `--surface`

  Also assert there is no `prefers-color-scheme` in global.css or card.css.
- [ ] **Step 2:** Run `npm test -w web -- contrast`. Expected: FAIL (old tokens, media query present).
- [ ] **Step 3:** Implement. Nudge `--muted` and the accents only as much as needed to pass.
- [ ] **Step 4:** Run `npm test -w web`. Expected: all PASS. Run `npm run build -w web`. Expected: success.
- [ ] **Step 5:** Commit `style(web): Midnight tokens, spacing scale and base components`.

---

### Task 2: Header order and brand

**Files:**
- Modify: `web/src/components/Layout.tsx`, `web/src/styles/global.css` (header styles), `web/src/components/bell.css` (re-tint)
- Test: `web/test/layout.test.tsx`

**Interfaces:**
- Produces:
  - Header DOM order: brand, nav links, spacer, then a right group of `NotificationBell`, the user (avatar + name) and the Log out button.
  - On phones the right group stays visible next to the Menu button, and the nav links collapse.
  - Brand: `<Link className="brand">Party<span>Finder</span></Link>`.

- [ ] **Step 1: Write the failing tests:**
  - `bell button precedes the Discord username in document order` (compare with `compareDocumentPosition`).
  - `brand renders Party and Finder`.
  - The existing layout tests stay.
- [ ] **Step 2:** Run `npm test -w web -- layout`. Expected: FAIL.
- [ ] **Step 3:** Implement. Log out uses `.btn--secondary`.
- [ ] **Step 4:** Run `npm test -w web`. Expected: PASS.
- [ ] **Step 5:** Commit `style(web): header layout — bell before user, new brand`.

---

### Task 3: Chip components

**Files:**
- Create: `web/src/components/ui/Chips.tsx`, `web/src/components/ui/chips.css`
- Test: `web/test/chips.test.tsx`

**Interfaces:**
- Produces:
  - `<ChipGroup<T extends string> label: string; options: { value: T; label: string }[]; value: T; onChange(v: T) />`:
    - It is `role="radiogroup"`, and each chip is `role="radio"` with `aria-checked`.
    - Roving tabindex: Left/Right move focus and select.
  - `<ToggleChip pressed: boolean; onToggle(); children />`: a `<button aria-pressed>`.
  - `<MenuChip label: string; valueLabel: string | null; options: { value: string; label: string }[]; value: string; onChange(v: string); disabled?: boolean; allLabel: string />`:
    - **Button:** shows `label: valueLabel` when a value is set, otherwise `label`. It has `aria-haspopup="listbox"` and `aria-expanded`.
    - **List:** opens a `role="listbox"` of `role="option"` items, with `allLabel` first (empty value).
    - **Keys:** Up/Down move, Enter selects, and Escape closes and returns focus to the button. An outside click closes it.

- [ ] **Step 1: Write the failing tests:**
  - ChipGroup click selects; ArrowRight moves focus and selection; only the checked chip is in the tab order.
  - ToggleChip toggles `aria-pressed`.
  - MenuChip:
    - opens on click and on Enter;
    - ArrowDown then Enter picks an option and calls `onChange`;
    - Escape closes and returns focus;
    - `disabled` blocks opening.
- [ ] **Step 2:** Run `npm test -w web -- chips`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test -w web -- chips`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(web): chip group, toggle chip and menu chip`.

---

### Task 4: Board filters as chips

**Files:**
- Modify: `web/src/pages/BoardPage.tsx`, `web/src/components/post/post.css`
- Test: `web/test/board.test.tsx` (rewrite the filter interactions to use chip roles)

**Interfaces:**
- Consumes: the Task 3 components.
- Produces:
  - **Type:** a ChipGroup with All / Recruiting / LFP.
  - **When:** a ChipGroup with Any / Next 24h / This week / Flexible.
  - **Boss:** a MenuChip with "All bosses". **Difficulty:** a MenuChip with "Any difficulty", disabled until a boss is chosen. **Guild:** a MenuChip with "All guilds".
  - **Worlds:** one ToggleChip per world.
  - **Unchanged:** world defaulting and the query semantics (`worldIds`, `flexible`, `from`/`to`) work exactly as today.
  - The title row uses `.page__head`, with the "New post" `a.button` on the right.

- [ ] **Step 1:** Update the tests to drive the chips:
  - Recruiting chip → `type=recruiting`.
  - Flexible chip → `flexible=1`.
  - Boss menu → `bossId=…`.
  - World toggle → `worldIds`.
  - Logged-in default worlds → the initial request has `worldIds=<kronosId>`, exactly one request.
  - Deselecting every world → no `worldIds`.
- [ ] **Step 2:** Run `npm test -w web -- board`. Expected: FAIL.
- [ ] **Step 3:** Implement. Keep the current list rendering for now; Task 6 replaces it.
- [ ] **Step 4:** Run `npm test -w web`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(web): board filters as chips`.

---

### Task 5: Extract shared post action components

**Files:**
- Create: `web/src/components/post/ViewerActions.tsx` (move `ViewerActions` and `RequestList` out of `PostDetailPage.tsx`, unchanged)
- Modify: `web/src/pages/PostDetailPage.tsx` (import them)
- Test: existing `web/test/postActions.test.tsx` and `web/test/postDetail.test.tsx` must pass unchanged; add `web/test/viewerActions.test.tsx`

**Interfaces:**
- Produces:
  - `export function ViewerActions({ post }: { post: PostDetailDTO }): JSX.Element | null`, with the same behavior as today: Request to join, Invite, Cancel, Accept/Decline for received invites, Leave, and the visitor prompt.
  - `export function RequestList(props)` with the same props as today.

- [ ] **Step 1: Write the failing test** `viewerActions.test.tsx`: render `<ViewerActions post={recruitingPost}>` alone, click Request to join, pick the Kronos character, and assert the POST body `{characterId}`.
- [ ] **Step 2:** Run `npm test -w web -- viewerActions`. Expected: FAIL (module missing).
- [ ] **Step 3:** Move the code without changing behavior. Restyle the buttons with `.btn` variants, and wrap action rows in `.actions`.
- [ ] **Step 4:** Run `npm test -w web`. Expected: PASS, including postActions and postDetail unchanged.
- [ ] **Step 5:** Commit `refactor(web): share viewer action components`.

---

### Task 6: Board list with selection, keyboard and phone mode

**Files:**
- Create: `web/src/hooks/useMediaQuery.ts`, `web/src/components/post/PostRow.tsx`
- Modify: `web/src/pages/BoardPage.tsx`, `web/src/components/post/post.css`
- Test: `web/test/boardList.test.tsx`, plus `web/test/setup.tsx` (a `matchMedia` mock helper `setViewport(width)` if none exists)

**Interfaces:**
- Produces:
  - `useMediaQuery(query: string): boolean`, with a `matchMedia` listener and SSR-safe default `false`.
  - `<PostRow post={PostSummaryDTO} selected: boolean; onSelect(): void; asLink: boolean />`:
    - **Element:** a real `<a href="/posts/:id">`.
    - **Contents:**
      - a small sprite thumbnail (the poster's `character.imageUrl`, or the snapshot image);
      - the type tag;
      - `bossLabel` list;
      - `formatWhen`;
      - poster IGN · guild;
      - for Recruiting posts, `memberCount / partySize` plus a cyan fill bar.
    - **Desktop:** a plain left-click selects (`preventDefault`); modifier and middle clicks fall through.
    - **Phone:** the link navigates.
  - Board list:
    - **Container:** `role="listbox"` with `aria-label="Posts"`. Rows are `role="option"` with `aria-selected`, with a single tab stop on the selected row.
    - **Keys:** Up/Down move the selection, and Enter navigates to `/posts/:id`.
    - **Selection state:** `?post=<id>` through `useSearchParams` with `{ replace: true }`. The default is the first post. An unknown id selects the first post and rewrites the URL.
    - **Phone:** `useMediaQuery('(max-width: 640px)')` hides the preview column and disables selection.
    - **Empty:** "No open posts match. Be the first to post!"
    - **Loading:** skeleton rows.

- [ ] **Step 1: Write the failing tests:**
  - First post selected by default and the URL gets `?post=p1`.
  - Clicking row 2 selects it and the URL updates.
  - **Review focus 2:** `?post=missing` selects p1 and rewrites the URL.
  - ArrowDown moves the selection; Enter navigates to `/posts/p2`.
  - **Review focus 3:** with `setViewport(375)`, clicking a row navigates to `/posts/p1`, and there is no preview region.
  - Empty state text.
  - The recruiting row shows `2 / 4`.
- [ ] **Step 2:** Run `npm test -w web -- boardList`. Expected: FAIL.
- [ ] **Step 3:** Implement. The preview column renders a placeholder until Task 7.
- [ ] **Step 4:** Run `npm test -w web`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(web): board post list with selection and keyboard support`.

---

### Task 7: Board preview pane

**Files:**
- Create: `web/src/components/post/PostPreview.tsx`
- Modify: `web/src/pages/BoardPage.tsx`, `web/src/components/post/LineupView.tsx` (add a `compact` prop: small sprite thumbnails and dashed open slots, no CP captions), `web/src/components/post/post.css`
- Test: `web/test/boardPreview.test.tsx`

**Interfaces:**
- Consumes: `usePost(id)`, `ViewerActions` (Task 5), `LineupView`, `StatusPill`, `formatWhen`, `bossLabel`, `formatCp`.
- Produces:
  - `<PostPreview postId: string | null />` is a `<section aria-label="Post preview">` showing:
    - the bosses title, `formatWhen`, world · guild, min CP and note;
    - `<LineupView compact>`;
    - `<ViewerActions>`;
    - for the poster, an "Edit" link to `/posts/:id/edit`;
    - an "Open post" link to `/posts/:id`.
  - **Other states:** a loading skeleton while fetching; an error state from `friendlyError`; `postId === null` shows "Pick a post to see its party".
  - The two-column layout on desktop puts the list at about 42% and the preview at about 58%. The preview is sticky at the top of the viewport.

- [ ] **Step 1: Write the failing tests:**
  - Selecting p2 fetches `/api/posts/p2` and shows its bosses and lineup (two members + two open slots for partySize 4).
  - **Review focus 5:** Request to join from the preview POSTs `/api/posts/p2/requests`.
  - The poster sees Edit linking to `/posts/p2/edit`; a non-poster doesn't.
  - "Open post" links to `/posts/p2`.
  - A preview fetch error shows the friendly message.
  - No posts → the placeholder text.
- [ ] **Step 2:** Run `npm test -w web -- boardPreview`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test -w web`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(web): board preview pane`.

---

### Task 8: Restyle the character pages and shared widgets

**Files:**
- Modify: `web/src/pages/characters.css`, `web/src/pages/CharactersPage.tsx`, `web/src/pages/MyCharactersPage.tsx`, `web/src/pages/CharacterFormPage.tsx`, `web/src/components/PlayTimeGrid.css`, `web/src/components/BossExperiencePicker.tsx` (class names only), `web/src/components/card/card.css` (only the card inner panels' inherited colors, if needed)
- Test: existing `characterPages`, `card` and `characterHooks` tests stay green.

**Interfaces:**
- Produces:
  - Pages use `.page` and `.page__head`.
  - **My characters:** each card's actions (Edit, Refresh from Nexon, Delete) sit in an `.actions` row under the card with `--space-3` gaps: Edit and Refresh as `.btn--secondary`, Delete as `.btn--danger`. The "Add character" button is primary in the page head.
  - **Characters page filters:** use chips (MenuChip for guild/world/archetype). The search input is styled.
  - **Character form:** fields in a single column with `--space-4` between them; Save is primary and Cancel secondary.

- [ ] **Step 1:** Update tests only where markup changed, such as character-page filters becoming MenuChips. Run `npm test -w web -- characterPages`. Expected: FAIL only on those queries.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** Run `npm test -w web`. Expected: PASS. Run `npm run build -w web`. Expected: success.
- [ ] **Step 4:** Commit `style(web): Midnight character pages with spaced actions`.

---

### Task 9: Restyle post pages, My parties, the bell and post components

**Files:**
- Modify: `web/src/pages/PostDetailPage.tsx` (class names), `web/src/pages/NewPostPage.tsx`, `web/src/pages/MyPartiesPage.tsx` (tabs become a ChipGroup or tab-styled links), `web/src/components/post/{post.css,PostCard.tsx,StatusPill.tsx,LineupView.tsx,BossMultiPicker.tsx,CharacterPicker.tsx}`, `web/src/components/bell.css`
- Test: existing `postDetail`, `postActions`, `newPost`, `myParties` and `bell` tests stay green.

**Interfaces:**
- Produces:
  - **Status pills:** re-tinted. Open uses cyan, Full violet, Closed muted, Deleted the danger tint.
  - **Type tags:** Recruiting is cyan on translucent cyan; Looking is `#b3a9ff` on translucent violet.
  - **Post detail page:** poster controls (Edit, Close, Renew, Delete) in an `.actions` row with variants; Delete is danger.
  - **New/edit post form:** spaced single column. The bosses picker is a panel; Save is primary.
  - **My parties tabs:** keep their `?tab=` behavior and accessible names.

- [ ] **Step 1:** Run `npm test -w web` after each sub-area while restyling. Change tests only if a query depended on removed markup, and note any such change in the report.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** Run `npm test -w web`. Expected: PASS. Run `npm run build -w web`. Expected: success.
- [ ] **Step 4:** Commit `style(web): Midnight post pages, My parties and notifications`.

---

### Task 10: Restyle admin pages

**Files:**
- Modify: `web/src/pages/admin/*.tsx` (class names; the PostsAdmin status filter becomes a ChipGroup), `web/src/pages/admin/admin.css`
- Test: existing `admin`, `adminWebhooks` and `adminModeration` tests stay green; update the PostsAdmin status-filter test to click a chip.

**Interfaces:**
- Produces:
  - Admin tabs styled as a chip/tab row.
  - Tables on `--surface` with `--border` rows and comfortable padding; stacked rows at ≤ 640px keep working.
  - Buttons use variants: Ban, Delete and Delete permanently are danger; Save and Create are primary.
  - Admin status pills (webhook health) re-tinted to match.

- [ ] **Step 1:** Update the PostsAdmin filter test to drive a ChipGroup. Run `npm test -w web -- adminModeration`. Expected: FAIL.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** Run `npm test -w web`. Expected: PASS.
- [ ] **Step 4:** Commit `style(web): Midnight admin pages`.

---

### Task 11: Sweep, palette guard and visual check

**Files:**
- Create: `web/test/palette.test.ts`
- Modify: any remaining CSS or TSX with old colors or ad-hoc spacing

**Interfaces:**
- Produces: `palette.test.ts` walks `web/src/**/*.{css,tsx,ts}` and fails if any old-palette hex from Global Constraints appears (case-insensitive).

- [ ] **Step 1: Write the test.** Run it. Expected: FAIL if anything remains, otherwise PASS. Record which.
- [ ] **Step 2: Remove leftovers.** Replace remaining hard-coded spacing values in page CSS with scale variables where practical.
- [ ] **Step 3: Visual check.**
  - Start the dev servers, or `docker compose up -d --build` with a throwaway `.env` that you delete afterwards.
  - Capture headless-Chrome screenshots of Board, a post, My characters, My parties and Admin → Guilds at 1280px and 375px. The pages that need a login can be checked by rendering them in tests instead.
  - Confirm: no horizontal scroll at 375px; buttons in rows have visible gaps.
  - Save the screenshots under `.superpowers/` (git-ignored) and list their paths in the report.
- [ ] **Step 4:** Run `npm test` (root), `tsc --noEmit -p web` and `npm run build -w web`. Expected: all PASS.
- [ ] **Step 5:** Commit `style(web): remove old palette, guard against regressions`.
