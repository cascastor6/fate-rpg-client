# Fate Table — Build Plan

The app is built one slice at a time. Each slice ends with:
1. `npm run typecheck`, `npm test` and `npm run build` passing.
2. Manual test steps (including the two-browser GM + player test where it applies).
3. A list of Supabase steps you need to do yourself.
4. A commit on the working branch with a clear message.
5. A stop for your review before the next slice starts.

"Two-browser test" means one normal window and one private/incognito window (or two different browsers). Each gets its own anonymous user. Use a phone on the same network, via `npm run dev -- --host`, for layout and touch checks. HTTPS-only features (wake lock, shake, PWA) are tested on a Vercel preview (Slice 8).

Section references (§) point to SPEC.md. Slice 7b was added for the Scenes & NPCs tab, so the original numbering is unchanged.

---

## Slice 1: Scaffold + Supabase schema, RLS, RPCs
**Build**
- Vite + React + TS (strict), Tailwind v4, React Router, and the `supabase-js` client. Dev dependencies: `vitest`, `supabase` (CLI).
- Scripts: `dev`, `build`, `preview`, `typecheck`, `test` (vitest), `test:rls`, `db:push` (`supabase db push`).
- `vercel.json` SPA rewrite; `.env.example` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`); `.gitignore`.
- Migrations `0001_schema.sql` … `0004_realtime.sql`: every table, trigger, helper, RLS policy, grant and RPC in §4, including scenes, zones, tokens and NPC visibility, so the RLS test covers everything from day one. The Vault pepper is created by the migration.
- `scripts/rls-test.mjs` with every check in §13.
- README: Supabase project setup, enabling anonymous sign-ins, `supabase login` / `link` / `db push` (or pasting into the SQL editor), env vars, `npm run dev -- --host`, `npm test`, `npm run test:rls`.
- Placeholder home page that signs in anonymously and shows "Connected as <uid>".

**Test**: `npm run dev` → the home page shows a uid. `npm test` passes. `npm run test:rls` → all PASS.

**You do in Supabase**:
1. Create the project.
2. Turn on anonymous sign-ins (Authentication → Sign In / Providers).
3. Run `npx supabase login`, then `npx supabase link --project-ref <ref>`, then `npm run db:push`.
4. Copy the URL and anon key into `.env.local`.

If Vault turns out to be disabled on your project, I'll tell you how to enable it.

---

## Slice 2: GM code create/reclaim, join by invite
**Build**
- Home: resume card, Join with code, and the **GM code textbox** with "Suggest one" and a strength hint.
- GM code flow (§3.3):
  - `claim_gm` → a match goes to `/s/:id/gm` (a placeholder GM screen listing members).
  - No match → "Create a session with this code?" (name, display name, colour) → `create_session` → invite link screen → GM screen.
- `/join/:code` → display name + colour swatches (§7.8) → `/s/:id` (a placeholder player screen). Colour change from the menu.
- `fate.last` resume logic, and "Leave session".
- `SessionProvider` (initial fetch; no realtime yet). Error mapping for `invalid_invite`, `weak_gm_code`, `gm_code_taken`, `rate_limited`.
- Unit tests: code normalisation and strength rules.

**Test (two browsers)**:
1. A types `ember lantern otter quarry`, confirms "create", and names the session.
2. B opens the invite link and joins as "Bea" with the pre-selected unused colour. A reloads and sees Bea in her colour.
3. B reloads and goes straight back in.
4. C (a third private window) types `Ember  Lantern Otter Quarry` and lands on the GM screen with no create prompt.
5. Error cases:
   - A typo'd code offers "Create one?", and cancelling creates nothing.
   - `short` is rejected as too weak.
   - 11 wrong codes show "Too many attempts".
   - A wrong invite shows "No session with that code".

**You do**: nothing new.

---

## Slice 3: Render a sheet from templates with per-block saving
**Build**
- Sheet types, the templates (§5.5; NPC template included, used in 7b), validation, and fractional positions.
- `/s/:id/new-character` picker → insert character + sections + blocks → sheet page.
- Play mode for all 9 block types, collapsible section cards, the fate point header, and a basic bottom bar (fate points −/+; Roll is a placeholder).
- Read-only rendering for sheets you can't edit.
- Skill rows show their pressable roll style, with the pencil for editing (the roll itself is wired in Slice 6).
- Bottom-sheet editor. Optimistic per-block operations (`patch_block`, `adjust_block_value`, `set_stress_box`, `adjust_fate_points`) through the in-memory queue (§6.3; persisted in Slice 8).
- Player **Table** tab listing the other PCs (opens them read-only). The GM can open and edit any PC from the placeholder GM screen.
- Unit tests: validation, templates, positions.

**Test**:
- At 375 px, create a Core character. Edit an aspect, a skill, stress, a consequence and fate points. Reload: everything persists.
- **Per-block saving**: change one block in the Supabase table editor while the sheet is open, then edit a *different* block in the app. Your table-editor change survives.
- **Two browsers**: B opens A's sheet from Table and sees it read-only. A forced `patch_block` from B's console gets an error toast and changes nothing.

**You do**: nothing new.

---

## Slice 4: Edit mode, sections, dnd-kit, templates, JSON export/import
**Build**
- Play/Edit toggle. dnd-kit drag handles for blocks (within and across sections) and for sections.
- Add, delete (with undo), change type and change label for blocks; type-specific settings.
- Add, rename and delete sections (`delete_section`); `rebalance_positions` when gaps get tiny.
- Apply template (with a confirm), export `.fate.json`, and import with validation, a preview and a confirm (`replace_sheet`).
- Unit tests: export/import round-trip.

**Test**:
- At 375 px in edit mode: drag a skill into Notes, reorder sections, add a counter with max 5, turn a text block into an aspect, delete a block and undo. Reload: the order persists.
- Export, create a Blank character, and import the file: the sheets match.
- A malformed file shows an error and changes nothing.
- Touch-dragging still lets the page scroll.

**You do**: nothing new.

---

## Slice 4b (added): templates while editing + GM-made templates
**Build**: §5.7 and the Templates part of §6.2. Migration `0006_templates.sql`: `characters.kind` gains `'template'`; `create_character`, `roll_dice` and `set_spotlight` are updated.
- GM screen → Templates card: New template, Offer to players / Stop offering, Delete template.
- Sheet tools → Save a copy as template.
- Edit-mode **Templates** sheet: Add to this sheet (merge) / Replace sheet.
- Character creation lists GM templates first.

**Test**:
1. The GM makes "Knight" based on Accelerated, adds an aspect "Oath", and leaves it as a draft. A joining player sees only the standard templates.
2. The GM offers it. The player's creation page shows **From your GM → Knight**, preselected. The created sheet has Oath.
3. In edit mode → Templates → Fate Core → **Add**: Skills etc. appear and Aspects merge into one section.
4. Templates → Knight → **Replace**: the sheet goes back to Knight, and the name is kept.
5. The GM uses Save a copy as template on a sheet, then Delete template.

**You do**: `npm run db:push` (applies `0006`).

---

## Slice 5: Realtime sheet sync
**Build**
- The per-session realtime channel (§10): filtered INSERT/UPDATE, unfiltered DELETE (unknown keys ignored), `visibility_changed` handling, version gating, and pending operations re-applied on top.
- Live members, characters, sections and blocks. Refetch on re-subscribe.
- Unit tests: the reducer's re-apply logic.

**Test (two browsers)**:
- The GM (A) and B both open B's sheet. B edits an aspect and A sees it within about 1 s, and the other way round.
- Simultaneous edits to *different* blocks both survive.
- A awards a fate point and B updates.
- B goes offline in DevTools for 30 s while A edits; B catches up on reconnect.
- A third browser in another session receives nothing (check the WS frames).

**You do**: if events don't arrive, check Database → Publications → `supabase_realtime` lists the tables.

---

## Slice 6: 4dF roller, synced CSS 3D animation, ladder, roll log
**Build**
- `ladder.ts`, the seeded PRNG, `Dice3D` (deterministic tumble, reduced-motion fallback), dice in the roller's colour (§7.8).
- Press a skill row to roll it (§6.1); the pencil edits it. The Roll dialog (plain, skill, bonus) → `roll_dice`; the roller animates from the response and the realtime copy is de-duplicated.
- The floating 4dF button (§7.5) on every session screen.
- Open/closed GM rolls (§7.9): the toolbar toggle, the per-roll switch, face-down placeholders for players, and Reveal.
- Roll log drawer for everyone.
- Unit tests: ladder text, PRNG determinism, rotation targets.

**Test (two browsers)**:
- **Synced rolls**:
  - B presses the Fight row (+3). Both windows tumble onto *identical* faces with identical text (e.g. "Bea: +1 Fight +3 = Great (+4)"), matching the `rolls` row.
  - Reload: history shows without replaying.
  - Reduced motion shows the fade fallback.
  - Pressing a skill row rolls immediately. Pressing the pencil on the same row opens the editor and doesn't roll. Rapid double presses give one roll. B pressing a skill on A's read-only sheet does nothing. The GM pressing B's skill on B's card rolls it as "GM · <B's character>".
- **Floating button**:
  - Tap it on B's sheet and on A's GM screen, and both animate everywhere.
  - A fast double-tap gives only one roll.
  - Long-press opens the dialog.
  - At 375 px it doesn't cover the bottom bar.
- **Colours**:
  - Blue (B) and red (A) dice and names show in both windows.
  - B switches to green: new rolls are green and old entries stay blue.
- **Closed GM rolls**:
  - A sets Closed and rolls. A sees "Hidden".
  - B sees face-down dice and "GM rolled behind the screen", and B's WS frames contain no faces.
  - Reveal animates B's entry onto the real result.
  - The per-roll Open override works.

**You do**: nothing new.

---

## Slice 7: GM Players tab, fate points, spotlight, members
**Build**
- GM layout with the two tabs and the shared toolbar (pool, roll mode, Clear highlight, log, members). The Scenes & NPCs tab is a placeholder until 7b.
- Players tab:
  - desktop grid of compact PC cards (colour border, empty blocks collapsed, stress toggles, award/take)
  - phone scroll-snap pager
  - the active scene strip (aspects + free invokes)
- GM fate pool: manual −/+ only.
- Spotlight (§8.2) for character aspects and consequences: `set_spotlight`, the player pop-up, vibration, the GM ring, Clear.
- Members panel: invite share, kick, assign character, change GM code.
- `session_events` toasts (basic; polished in Slice 8).

**Test (two browsers + phone)**:
- **Cards**: the GM on desktop with B and C sees 2 live cards. Awarding B a point shows a toast on B, and the GM pool doesn't change. At 375 px the GM view becomes swipeable cards.
- **Kick and code**: kicking C sends C home with a message. Changing the GM code makes the old one stop working.
- **Spotlight**:
  - Tap B's High Concept. Within about 1 s B vibrates and shows "Your high concept", and C sees "Bea's high concept". Nothing scrolls.
  - C dismisses it and reloads: it doesn't return. An untouched pop-up closes itself after 8 s.
  - With a bottom sheet open on B, a new highlight waits until the sheet closes.
  - Clear closes it everywhere.
  - A forced `set_spotlight` from B is denied.

**You do**: nothing new.

---

## Slice 7b: Scenes & NPCs tab
**Build**
- **Scene list** (§8.3.1): create (narrative or zones), rename, duplicate, delete, reorder, **Show to players** (active scene), and kind switching.
- **Narrative scenes** (§8.3.2): a sortable aspect list with free invokes, and toasts when an aspect is added to the active scene.
- **Zones board** (§8.3.3):
  - the 1600 × 1000 board with zoom, Fit and pinch/pan
  - zones: add, drag by title, resize from the corner, rename, recolour, delete, and bring to front
  - aspect chips inside zones, dragged between zones and the Unzoned tray
  - tokens: add PCs, NPCs or free tokens, "Add all PCs", free dragging with no snapping, and the token menu
  - keyboard moves
- **NPC roster** (§8.3.5):
  - NPC template cards with inline name, aspects and fillable skills, plus **+ Aspect** / **+ Skill**
  - press a skill to roll it (pencil to edit), star to spotlight
  - duplicate, delete, reorder, search
  - **Show to players**, Add to scene, open full sheet, export/import
- Player **Scene** tab (§8.3.4): the active scene read-only (list or board with zoom/pan). Visible NPCs appear in the player's Table tab.
- Spotlight extended to scene aspects (active scene only) and NPC aspects.
- Unit tests: board math (screen ↔ board, clamping, zoom).

**Test (two browsers + phone)**:
- **Prep and sharing**:
  - The GM creates "Docks (prep)" (zones) and "Tavern" (narrative). B's Scene tab shows "The GM hasn't shared a scene yet" (or Scene 1).
  - The GM shows Tavern: B's tab switches to its aspect list live.
  - The GM adds "Smoky" and B gets a toast.
- **Zones board**:
  - The GM builds Docks: 3 zones ("Pier", "Warehouse", "Boat"), drags them into place, resizes "Pier", adds "Slippery Planks" to Pier, then drags it to Warehouse.
  - Adds all PC tokens plus an NPC "Smuggler", and drags them over different zones (they land exactly where dropped, with no snapping).
  - Reload: everything is where it was left.
  - The GM shows Docks. B sees the same layout at Fit, can pinch-zoom and pan on the phone, and can't drag anything.
  - The GM moves the Smuggler token: B sees it jump on drop.
- **NPCs**:
  - The GM makes an NPC "Thug": fills a skill "Fight +2", adds a third aspect with **+ Aspect**, rolls Fight (closed), and duplicates it to "Thug 2".
  - B's Table tab doesn't list Thug. B's console select on `characters` returns no NPC rows.
  - The GM toggles Show to players, and Thug appears read-only for B. Toggling it off makes Thug disappear for B without a reload.
- **Spotlight**: on "Slippery Planks", B's pop-up reads "Scene aspect · Warehouse".
- **Permissions**: forced scene, zone or token writes from B are denied.

**You do**: nothing new.

---

## Slice 8: Mobile/PWA: wake lock, offline queue, shake, haptics, toasts, big result

> **Skipped at the user's request.** None of this is built: no service worker or install, no persisted offline queue (edits made offline are still queued in memory and retried), no wake lock, shake, extra haptics or big result view. SPEC §7.7 and §9.2–9.4 describe it if it's picked up later.
**Build**
- `vite-plugin-pwa`: manifest, icons, a service worker, and the update toast.
- Persistent cache and queue, the offline banner, and the reconnect flush → refetch sequence (§9.3), covering sheet and GM scene/board edits. Rolling is disabled offline.
- Wake lock, shake-to-roll (iOS permission), vibration, the polished toast system, and the big result view (§7.7).
- Sticky bottom bar, top tabs and floating button finalised (safe areas, menu contents).

**Test**:
- **Install**: Lighthouse installability check, then install on Android/iOS from the **Vercel preview URL**.
- **Offline**: in airplane mode, make 3 edits ("3 changes waiting"). Reload offline: the cached sheet renders. Reconnect: the changes sync, and the GM browser sees them.
- **GM offline**: move a zone, reconnect, and the move syncs.
- **Wake lock** keeps the screen on.
- **Shake**: enable → accept the iOS prompt → shake → a roll happens.
- **Feedback**: Android vibrates on landing, a GM award toasts on the phone, and the big result shows after a roll and closes on tap.

**You do**:
1. Connect the GitHub repo to Vercel (import the project, framework preset Vite) and add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel's environment variables. Every push to the branch then gets a preview URL.
2. Optionally, add the Vercel domain under Supabase Auth → URL Configuration.

---

## Slice 9: Polish: dark mode, empty states, error handling
**Build**
- Light/dark/system theme with checked contrast, including the board felt, zones and tokens. Empty states (§12) and an error boundary.
- Consistent error messages, loading skeletons, and a 404 page.
- An accessibility pass (focus, aria-live for rolls and spotlight, labels, keyboard board moves) and a final README pass.

**Test**:
- Every screen in dark and light, at 375 px and on desktop.
- Kill the network mid-action.
- Open a deleted session's URL.
- Keyboard only: edit a sheet, roll, and move a zone and a token.
- Re-run `npm run test:rls`.

**You do**: final Vercel production deploy. If the app will be public, turn on Supabase Auth CAPTCHA for anonymous sign-ins.

---

## Cross-cutting
- The **RLS test** covers the whole schema from Slice 1 and is re-run at the end of slices 2, 3, 6, 7, 7b and 9.
- The **README** is updated in every slice where setup changes.
- **No new dependencies** beyond SPEC §2 without asking first.
