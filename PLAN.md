# Fate Table — Build Plan

The app is built one slice at a time. Each slice ends with:
1. `npm run typecheck` and `npm run build` passing.
2. Manual test steps (including the two-browser GM + player test where it applies).
3. A list of Supabase steps you need to do yourself.
4. A commit on the working branch with a clear message.
5. A stop for your review before the next slice starts.

"Two-browser test" means one normal window and one private/incognito window (or two different browsers). Each gets its own anonymous user. Use a phone on the same network, via `npm run dev -- --host`, for mobile checks.

Section references (§) point to SPEC.md.

---

## Slice 1: Scaffold + Supabase schema, RLS, RPCs
**Build**
- Vite + React + TS (strict), Tailwind v4, React Router, a `supabase-js` client, ESLint off (not requested).
- Scripts: `dev`, `build`, `preview`, `typecheck`, `test:rls`.
- `vercel.json` SPA rewrite; `.env.example` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`); `.gitignore`.
- Migrations `0001_schema.sql` … `0004_realtime.sql`: all tables, triggers, helper functions, RLS policies, grants and RPCs from §4. Block RPCs are included now and used from Slice 3.
- `scripts/rls-test.mjs` (§13).
- README: creating the Supabase project, enabling anonymous sign-ins, running migrations (SQL editor or CLI), env vars, `npm run dev -- --host`, and running the RLS test.
- Placeholder home page that signs in anonymously and shows "Connected as <uid>".

**Test**: `npm run dev` → the home page shows a uid. `npm run test:rls` → all PASS.

**You do in Supabase**: create the project, enable anonymous sign-ins, run the 4 migrations, and copy the URL and anon key into `.env.local`. The migration creates the GM-code pepper in Supabase Vault itself, so there's nothing to configure; if Vault turns out to be disabled on your project, I'll tell you how to enable it.

---

## Slice 2: Create session / join by invite / GM reclaim
**Build**
- Home screen with: resume card, Join with code, and a **GM code textbox** (with a "Suggest one" button and a strength hint).
- GM code flow (SPEC §3.3): `claim_gm` → a match goes to `/s/:id/gm` (a placeholder GM screen listing members). No match → "Create a session with this code?" (name, display name, colour) → `create_session` → invite link screen → GM screen.
- `/join/:code` → display name + colour swatches (SPEC §7.8) → `/s/:id` (a placeholder player screen). Create session also has a colour picker. Colour change in the menu.
- `fate.last` resume logic, and "Leave session".
- `SessionProvider` (initial fetch only; no realtime yet). Error mapping for `invalid_invite`, `weak_gm_code`, `gm_code_taken` and `rate_limited`.

**Test (two browsers)**: A types the GM code `ember lantern otter quarry`, confirms "create", and names the session → B opens the invite link, joins as "Bea", accepts the pre-selected unused colour (different from A's) → A reloads and sees Bea in the member list with her colour. B reloads and goes straight back in. C (a third private window) types `Ember  Lantern Otter Quarry` (different case and spacing) and lands straight on the GM screen, with no create prompt. A typo'd code shows "No session uses this code yet. Create one?", and cancelling creates nothing. `short` is rejected as too weak. 11 wrong codes in a row show "Too many attempts, try again in a few minutes". A wrong invite shows "No session with that code".

**You do**: nothing new.

---

## Slice 3: Render a sheet from templates with per-block saving
**Build**
- Sheet types, the 4 templates (§5.5), validation.
- `/s/:id/new-character` picker → insert character → sheet page.
- Play mode for all 9 block types, collapsible section cards, the fate point header, and a basic bottom bar (fate points −/+; Roll is a disabled placeholder).
- Bottom-sheet editor. Optimistic per-block operations (`update_block`, `adjust_block_value`, `set_stress_box`, `adjust_fate_points`) through the in-memory queue (§6.3; persisting the queue comes in Slice 8).
- The GM can open any character from the placeholder GM screen and edit it.

**Test**: Create a Core character at 375 px (DevTools device mode). Edit an aspect, change a skill, tick stress, set a consequence and change fate points. Reload: everything persists. In the Supabase table editor, change one block's value while the sheet is open, then edit a *different* block in the app: your table-editor change survives, which proves per-block saving. Two browsers: player B can't edit A's character (controls read-only; a forced RPC gets an error toast).

**You do**: nothing new.

---

## Slice 4: Edit mode, sections, dnd-kit, templates, JSON export/import
**Build**
- Play/Edit toggle. dnd-kit drag handles for blocks (within and across sections) and for sections.
- Add, delete (with an undo toast), change type and change label for blocks; type-specific settings.
- Add, rename and delete sections (`set_sections`, `move_block`, `insert_block`, `delete_block`).
- Apply template (with a confirm), export `.fate.json`, and import with validation, a preview and a confirm (`replace_sheet`).

**Test**: In edit mode at 375 px, drag a skill into Notes, reorder sections, add a counter with max 5, change a text block to an aspect, delete a block and undo. Reload and check that the order persists. Export, then create a Blank character and import the file: the sheets match. Importing a malformed file shows an error and changes nothing. Touch-drag on a phone or emulator still allows the page to scroll.

**You do**: nothing new.

---

## Slice 5: Realtime sheet sync
**Build**
- A per-session realtime channel (§10) feeding the `SessionProvider` reducer, with version gating and pending operations re-applied on top.
- Live member list and character list. Reconnect handling (refetch on re-subscribe).

**Test (two browsers)**: The GM (A) and player (B) both open B's sheet. B edits an aspect and A sees it within about 1 s, and the other way round. Both edit *different* blocks at the same moment and both edits survive. A awards a fate point and B's counter updates. Turn B's network off in DevTools for 30 s, make GM edits, then turn it back on: B catches up. A third browser in a different session sees nothing from this session.

**You do**: confirm realtime is enabled for the tables (the migration adds them to `supabase_realtime`; check Database → Publications if events don't arrive).

---

## Slice 6: 4dF roller, synced CSS 3D animation, ladder, roll log
**Build**
- `ladder.ts`, the seeded PRNG, the `Dice3D` component (4 cubes, deterministic tumble, reduced-motion fallback).
- Tap a skill to roll. The Roll button opens the roll dialog (plain, skill or bonus) → `roll_dice` RPC → the animation plays from the response, and the realtime copy is de-duplicated.
- Dice, log entries and the big result in the roller's colour (SPEC §7.8).
- Open/closed GM rolls (SPEC §7.9): the session toggle, a per-roll switch in the GM's roll dialog, face-down placeholders for players, and Reveal.
- Floating 4dF button (SPEC §7.5) on the sheet and the GM screen: one tap does a plain roll, long-press opens the roll dialog, and it is locked while a roll is in flight.
- Every client animates new rolls. The result line matches §7.3. A roll log drawer (latest 50 + live) is available to everyone, including the GM screen.

**Test (two browsers)**: B taps Fight (+3). Both windows tumble and land on *identical* faces, and the result text is the same in both (e.g. "+1 Fight +3 = Great (+4)", depending on what the server decided). Check that the log entry matches the `rolls` row in the table editor. Reload A: the log shows history without replaying animations. Turn on reduced motion in the OS or DevTools and check the fade fallback. Check boundary ladder text by temporarily giving a skill +8. Floating button: tap it on B's sheet and on A's GM screen; both windows animate both rolls. Double-tapping it fast produces only one roll. Colours: B (blue) and A (red) roll; both windows show blue and red dice and log names respectively. B changes colour to green: new rolls are green, old log entries stay blue. Closed GM rolls: A switches to Closed and taps the floating button. A sees the result marked Hidden; B sees face-down dice and "GM rolled behind the screen". In B's DevTools Network/WS frames, no faces arrive. A taps Reveal, and B's entry animates to the real result. Per-roll override: with Closed set, A opens the dialog, switches to Open and rolls, and B sees it normally. Long-press opens the dialog. At 375 px it sits above the bottom bar and doesn't cover the fate point or menu buttons.

**You do**: nothing new.

---

## Slice 7: GM screen, scene aspects, fate point controls
**Build**
- Desktop grid of compact character cards (§8), with empty blocks collapsed and an expand chip. Stress toggles and award/take buttons on each card.
- Phone: a scroll-snap swipe pager with dots and name chips.
- Scene aspects panel (GM: add, edit, delete, reorder, free invokes −/+; players: read-only collapsible panel on the sheet).
- GM fate point pool with "reset to N". Members panel: invite share, kick, assign character.
- `session_events` subscription with basic toasts (moved to the polished toast system in Slice 8).

**Test (two browsers + phone)**: The GM on desktop with 2 players (B, C) sees 2 cards updating live. Award B a point: B sees the counter change and a toast. Add a scene aspect "On Fire" with 1 free invoke: B and C see it read-only, and B can't edit it (UI hidden; a forced RPC is denied). Resize to 375 px: the GM view becomes swipeable cards. Kick C: C is sent back to the home page with a message.

**You do**: nothing new.

---

## Slice 8: Mobile/PWA: wake lock, offline queue, shake, haptics, toasts, big result
**Build**
- `vite-plugin-pwa`: manifest, icons, a service worker, and an update-available toast.
- Persistent cache and queue in localStorage, an offline banner, and the reconnect flush → refetch sequence (§9.3). Roll is disabled while offline.
- Wake lock toggle, shake-to-roll enable button (with the iOS permission prompt), vibration on landing, the polished toast system, and the full-screen big result view (SPEC §7.7).
- Sticky bottom bar and floating 4dF button finalised (safe areas, menu contents, disabled while offline).

**Test**: Lighthouse (DevTools) PWA installability check, then install on Android (Chrome) or iOS (Share → Add to Home Screen) from an HTTPS URL (see the note on HTTPS below). Turn on airplane mode, make 3 edits (the banner shows "3 changes waiting"), reload while still offline (the sheet renders from cache), reconnect (changes sync, and the GM browser sees them). Wake lock: the screen stays on with the toggle on. Shake: tap enable → accept the iOS prompt → shake → a roll happens. Android vibrates on landing. A GM award shows a toast on the phone. After any roll the phone shows the big result, and a tap dismisses it.

**You do**: deploy to Vercel (or a preview) with the env vars set, so you can test HTTPS-only features on the phone. Add the Vercel domain to Supabase Auth → URL Configuration (not strictly needed for anonymous auth, but useful later).

---

## Slice 9: Polish: dark mode, empty states, error handling
**Build**
- A light/dark/system theme toggle with checked contrast. Empty states (§12). An error boundary.
- A consistent RPC error → message map, loading skeletons, and a 404 page.
- An accessibility pass (focus, aria-live for rolls, labels) and a final README pass.

**Test**: Go through every screen in dark and light at 375 px and on desktop. Kill the network during actions. Open a deleted session's URL. Use the keyboard only to edit a sheet and roll. Re-run `npm run test:rls`.

**You do**: final Vercel deploy, and turn on Supabase's Auth CAPTCHA for anonymous sign-ins if the app will be public (abuse protection).

---

## Cross-cutting
- **RLS test** written in Slice 1 and extended whenever a new table or RPC appears; re-run at the end of slices 2, 3, 6, 7 and 9 (Slice 6 adds the hidden-roll and colour checks).
- **README** updated in every slice where setup changes.
- **No new dependencies** beyond SPEC §2 without asking first.
