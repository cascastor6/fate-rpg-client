# Fate Table — Specification

A web app for running Fate RPG sessions (Fate Core, Fate Accelerated, Fate Condensed): block-based character sheets, server-decided 4dF dice with a synced animation, and a live GM screen. The player sheet is mobile-first and installable as a PWA.

---

## 1. Goals and non-goals

**Goals**
- No accounts. Everyone signs in with Supabase anonymous auth without noticing.
- A GM creates a session, invites players with a link, and runs the game from a live GM screen.
- Players keep a flexible, block-based character sheet on their phone.
- Dice results are decided once on the server, and every client shows the same faces.
- All shared state is live through Supabase Realtime.

**Non-goals for v1**
- Email or OAuth accounts, or linking an anonymous user to a real account.
- A dice physics engine (we use CSS 3D only).
- NPC/monster management beyond what the GM can model as an ordinary character (see Open Questions).
- Maps, chat, voice, or a rules engine. The app tracks state; people apply the rules.
- Cleaning up old anonymous users or sessions.

---

## 2. Stack

| Concern | Choice |
|---|---|
| Build | Vite + React 18 + TypeScript (strict) |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite`), `dark` variant switched by a class on `<html>` |
| Routing | React Router (`react-router-dom`) |
| Backend | Supabase: Postgres, anonymous auth, RLS, Realtime, RPCs |
| Drag and drop | `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` |
| PWA | `vite-plugin-pwa` (Workbox `generateSW`) |
| Deploy | Vercel (static SPA with a rewrite to `index.html`) |
| Migrations | Plain SQL in `/supabase/migrations/*.sql` |

No other runtime dependencies. Icons are inline SVG. Toasts, bottom sheets, the swipe view and the dice are hand-written. Any extra dependency, dev-only ones included, needs approval first (see §13).

---

## 3. Identity, sessions and access

### 3.1 Anonymous auth
- On first load the app calls `supabase.auth.signInAnonymously()` if there is no Supabase auth session. The Supabase client keeps its own auth session in localStorage, so the same anonymous `auth.uid()` survives reloads on that device.
- Every row ties back to `auth.uid()`. A "user" means one browser on one device.

### 3.2 Codes
- **Invite code**: 6 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0/O/1/I), e.g. `K7QPMX`. It is not secret; anyone with it can join as a player. Invite URL: `https://<host>/join/K7QPMX`.
- **GM code**: chosen by the GM, typed into a textbox. **Entering a code that no session uses yet is how a session is created**; entering it again later, on any device, makes you that session's GM.
  - **Normalisation** (client and server): trim, collapse inner whitespace to one space, lower-case. `Silver Order Falls` and `silver  order falls` are the same code.
  - **Strength rule** (checked in the client and again in the RPC): at least 10 characters after normalisation, not just one repeated character, and not on a short built-in blocklist (`password…`, `fatecore…`, `1234567890`, and so on). A **"Suggest one"** button fills in 4 random words from a word list bundled in the app, e.g. `ember-lantern-otter-quarry`, which gives about 41 bits of entropy.
  - **Uniqueness**: a code belongs to exactly one session (unique index on its hash).
  - **Storage**: only `hmac(normalised_code, pepper, 'sha256')` is stored, in `session_secrets`, which no client role can read. The pepper is a random 32-byte secret that the migration creates in Supabase Vault (`gm_code_pepper`); it is never in a table. A deterministic keyed hash, rather than bcrypt, is needed so the server can find the session from the code alone. The pepper means a leaked table can't be brute-forced without the Vault secret too.
  - **Guessing protection**: failed `claim_gm` attempts are recorded per user. More than 10 failures in 10 minutes gives `rate_limited`. Supabase's own limit on anonymous sign-ins per IP caps how many fresh users one attacker can make.
  - The app never stores the GM code. After creation it reminds the GM to remember or write it down.
- Code checks run server-side in `SECURITY DEFINER` RPCs.

### 3.3 Flows
1. **GM: enter a GM code** (`/` → the "GM code" textbox → Continue). The app calls `claim_gm(code)`:
   - **The code matches a session**: you become its GM and go to the GM screen (this is reclaim; see 3).
   - **No session uses it**: the same card expands to "No session uses this code yet. Create one?" with fields for session name, your display name and your colour (§7.8) → `create_session(code, …)` → a screen showing the invite link (copy and share), with a reminder that the GM code is what gets you back in → GM screen.
   - **Code too weak**: an inline message with the rule, plus the "Suggest one" button.
   Because a new code never silently creates a session (there's a confirm step), a typo while reclaiming can't spin up an unwanted session.
2. **Join** (`/join/:code`, or type the code on `/`): enter a display name and pick a player colour (§7.8) → `join_session()` → the player picks a template and names their character on first entry → player sheet.
3. **GM reclaim**: the same textbox as step 1. A matching code → GM screen. This works on any device. If that device's user was already a player in the session, they are promoted to GM. Several devices can be GM at once; reclaiming does not revoke the others.
4. **Resume**: localStorage key `fate.last` = `{ sessionId, inviteCode, role, displayName }`. On launch, if it exists and the user is still a member (checked with a select on `session_members`), the app goes straight in. If not, the key is cleared and the home screen is shown.

### 3.4 Lost identity
If a player clears site data, they get a new anonymous user and lose ownership of their character. The GM can reassign any character in the session to any member with `assign_character()`. The GM sees an "Unclaimed / orphaned" badge on characters whose owner is no longer a member.

---

## 4. Database schema

All tables live in `public`. Extensions: `pgcrypto`, Supabase Vault (`supabase_vault`, enabled by default on hosted projects). Every table has RLS enabled. `updated_at` is maintained by a shared trigger.

### 4.1 Tables

```sql
-- sessions -----------------------------------------------------------------
create table sessions (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (char_length(name) between 1 and 80),
  invite_code    text not null unique check (invite_code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  gm_fate_points int  not null default 0 check (gm_fate_points >= 0),
  gm_roll_mode   text not null default 'open' check (gm_roll_mode in ('open','closed')),  -- §7.9
  spotlight      jsonb,  -- what the GM is highlighting right now, or null (§8.1); written only by set_spotlight
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- session_secrets: one row per session; NO policies -> unreadable by clients.
create table session_secrets (
  session_id   uuid primary key references sessions(id) on delete cascade,
  gm_code_hash text not null unique     -- hex(hmac(normalised code, vault pepper, 'sha256'))
);

-- gm_code_attempts: failed claim_gm calls, for rate limiting. NO policies.
create table gm_code_attempts (
  user_id      uuid not null references auth.users(id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index on gm_code_attempts (user_id, attempted_at desc);

-- session_members ----------------------------------------------------------
create table session_members (
  session_id   uuid not null references sessions(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null check (role in ('gm','player')),
  display_name text not null check (char_length(display_name) between 1 and 40),
  color        text not null default 'slate' check (color in
                 ('red','orange','amber','lime','green','teal','cyan','blue','indigo','violet','pink','slate')),  -- §7.8
  joined_at    timestamptz not null default now(),
  primary key (session_id, user_id)
);
create index on session_members (user_id);

-- characters ---------------------------------------------------------------
create table characters (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references sessions(id) on delete cascade,
  owner_id    uuid references auth.users(id) on delete set null,
  name        text not null default 'Unnamed' check (char_length(name) <= 80),
  template    text not null check (template in ('core','accelerated','condensed','blank')),
  fate_points int  not null default 3 check (fate_points >= 0),
  refresh     int  not null default 3 check (refresh >= 0),
  sections    jsonb not null default '[]'::jsonb,   -- ordered Section[] (see §5.1)
  blocks      jsonb not null default '[]'::jsonb,   -- ordered Block[]   (see §5.2)
  version     bigint not null default 1,            -- bumped on every update
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (jsonb_typeof(sections) = 'array' and jsonb_typeof(blocks) = 'array')
);
create index on characters (session_id);

-- rolls (insert-only through roll_dice) ------------------------------------
create table rolls (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references sessions(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete set null,
  character_id uuid references characters(id) on delete set null,
  roller_name  text not null,           -- display name snapshot
  roller_color text not null,           -- colour snapshot, so old log entries keep their colour
  is_hidden    boolean not null default false,  -- closed GM roll (§7.9)
  revealed_at  timestamptz,
  label        text,                    -- e.g. 'Fight', null for a plain roll
  skill_value  int  not null default 0, -- read server-side from the skill block
  bonus        int  not null default 0, -- extra modifier the roller entered
  faces        smallint[] not null check (array_length(faces,1) = 4 and faces <@ array[-1,0,1]::smallint[]),
  dice_total   int  not null,           -- sum(faces)
  total        int  not null,           -- dice_total + skill_value + bonus
  created_at   timestamptz not null default now()
);
create index on rolls (session_id, created_at desc);

-- scene_aspects ------------------------------------------------------------
create table scene_aspects (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references sessions(id) on delete cascade,
  text         text not null check (char_length(text) between 1 and 200),
  free_invokes int  not null default 0 check (free_invokes between 0 and 99),
  position     int  not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on scene_aspects (session_id, position);

-- session_events: notifications shown as toasts (insert-only through RPCs/triggers)
create table session_events (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null references sessions(id) on delete cascade,
  kind                text not null check (kind in
                        ('scene_aspect_added','fate_point_awarded','fate_point_taken','member_joined','hidden_roll')),
  target_character_id uuid references characters(id) on delete cascade,
  payload             jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);
create index on session_events (session_id, created_at desc);
```

Triggers:
- `touch_updated_at` (before update) on `sessions`, `characters`, `scene_aspects`.
- `characters_bump_version` (before update): `new.version := old.version + 1`. It also rejects changes to `session_id`, and rejects changes to `owner_id` unless the caller is a GM of the session.
- `scene_aspect_added_event` (after insert on `scene_aspects`): inserts a `session_events` row (`payload: { text }`).
- `member_joined_event` (after insert on `session_members`, role `player`).

Realtime: the migration adds `sessions`, `session_members`, `characters`, `rolls`, `scene_aspects` and `session_events` to the `supabase_realtime` publication. Realtime `postgres_changes` applies RLS to each subscriber, so clients receive only rows they can select.

### 4.2 Helper functions
`SECURITY DEFINER`, `STABLE`, `search_path = public`. They exist so policies can check membership without recursive RLS on `session_members`.

```sql
is_session_member(p_session_id uuid) returns boolean  -- auth.uid() has any role in session
is_session_gm(p_session_id uuid)     returns boolean  -- auth.uid() has role 'gm'
```

### 4.3 Row-level security

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `sessions` | `is_session_member(id)` | — (RPC only) | `is_session_gm(id)`; column grant limited to `name`, `gm_fate_points`, `gm_roll_mode` | `is_session_gm(id)` |
| `session_secrets`, `gm_code_attempts` | — | — | — | — (no policies; all privileges revoked from `anon` and `authenticated`) |
| `session_members` | `is_session_member(session_id)` | — (RPC only) | own row (`user_id = auth.uid()`); column grant limited to `display_name`, `color` | own row (leave) or `is_session_gm(session_id)` (kick) |
| `characters` | `is_session_member(session_id)` | member, and `owner_id = auth.uid()` or `is_session_gm(session_id)` | `owner_id = auth.uid()` or `is_session_gm(session_id)`; `WITH CHECK` same, plus the trigger guards `session_id`/`owner_id` | same as UPDATE |
| `rolls` | `is_session_member(session_id) and (not is_hidden or is_session_gm(session_id))`, so players never receive closed GM rolls, not even over realtime | — (RPC only, so results can't be forged) | — (reveal goes through `reveal_roll`) | — |
| `scene_aspects` | `is_session_member(session_id)` | `is_session_gm(session_id)` | `is_session_gm(session_id)` | `is_session_gm(session_id)` |
| `session_events` | `is_session_member(session_id)` | — (RPC/trigger only) | — | — |

So:
- A member can read only the sessions they belong to and everything inside them. Players can see other players' sheets read-only (see Open Questions).
- A player can change only characters where `owner_id = auth.uid()`.
- The GM can read and change everything in their session.
- `anon` (the role before sign-in) gets nothing. Every grant is to `authenticated`, and anonymous Supabase users carry the `authenticated` role.

### 4.4 RPCs

`SECURITY DEFINER` functions bypass RLS, so each one checks authorization itself. `SECURITY INVOKER` functions run under RLS, so the policies above are the authorization. Every function sets `search_path = public, extensions`. `execute` is revoked from `public` and `anon` and granted to `authenticated`.

| Function | Mode | Behaviour |
|---|---|---|
| `create_session(p_gm_code text, p_name text, p_display_name text, p_color text default null) returns table(session_id uuid, invite_code text)` | definer | Requires `auth.uid()`. Normalises the code and enforces the strength rule (`weak_gm_code`). Generates a unique invite code, retrying on collision. Inserts the `sessions` row, the `session_secrets` row (peppered HMAC of the code) and a `session_members` row with role `gm` (with `p_color`, default `slate`). If the code's hash already exists (two people raced for the same new code) it raises `gm_code_taken`, and the client retries `claim_gm`. |
| `join_session(p_invite_code text, p_display_name text, p_color text default null) returns uuid` | definer | Looks up the session by normalised code and raises `invalid_invite` if none. Inserts the member as `player`. If `p_color` is null it assigns the first palette colour nobody in the session uses yet. If already a member, updates `display_name` (and `color` if given) and keeps the role. Returns `session_id`. |
| `claim_gm(p_gm_code text) returns uuid` | definer | First checks the rate limit (`rate_limited`). Then normalises the code, computes the HMAC and looks it up. **No match**: records an attempt and returns `null`; the client then offers to create a session. **Match**: upserts the member with role `gm` (`display_name` defaults to 'GM' if new) and returns `session_id`. |
| `change_gm_code(p_session_id uuid, p_new_code text) returns void` | definer | GM only. Applies the strength rule and uniqueness (`weak_gm_code`, `gm_code_taken`), then replaces the hash. Existing GM devices keep their access. |
| `roll_dice(p_session_id uuid, p_character_id uuid default null, p_block_id text default null, p_bonus int default 0, p_label text default null, p_hidden boolean default null) returns rolls` | definer | Requires membership. Snapshots the caller's `display_name` and `color`. **Hidden:** a non-GM passing `p_hidden = true` gets `not_gm`. For a GM, `null` means use `sessions.gm_roll_mode`. A hidden roll also inserts a `hidden_roll` session event with `payload: { roll_id, roller_name, roller_color }` and no result, so players know a roll happened. If `p_block_id` is given, the character must be in the session and either owned by the caller or the caller is GM; `skill_value` is read from that skill block and `label` defaults to its label. `p_bonus` is clamped to -20..20. Each face is `floor(random()*3)::int - 1`. Inserts the row and returns it. |
| `adjust_fate_points(p_character_id uuid, p_delta int) returns int` | invoker | Atomic `fate_points = greatest(0, fate_points + p_delta)`, under RLS (owner or GM). Returns the new value. If the caller is a GM and not the owner, it also inserts a `session_events` row (`fate_point_awarded` / `fate_point_taken`, `payload: { delta }`). Creating the event needs definer rights, so the event insert lives in a small internal definer helper. |
| `adjust_gm_pool(p_session_id uuid, p_delta int) returns int` | invoker | Atomic `gm_fate_points = greatest(0, gm_fate_points + p_delta)`, GM only through RLS. |
| `update_block(p_character_id uuid, p_block_id text, p_patch jsonb) returns bigint` | invoker | Shallow-merges `p_patch` into the one block with that id (`block || patch`). `id` and `type` are stripped from the patch. Raises `block_not_found`. Returns the new `version`. Two people editing different blocks, or different fields of one block, never overwrite each other. |
| `adjust_block_value(p_character_id uuid, p_block_id text, p_delta numeric) returns jsonb` | invoker | Atomic increment for `counter`, `number` and `skill` blocks. Counters are clamped to `0..max` when `max` is set. Returns the block. |
| `set_stress_box(p_character_id uuid, p_block_id text, p_index int, p_checked boolean) returns jsonb` | invoker | Sets a single box, so toggles from two people don't clobber each other. |
| `insert_block(p_character_id uuid, p_block jsonb, p_before_block_id text default null) returns bigint` | invoker | Validates `id`/`type`/`section` (see §5.4) and inserts before the given block, or at the end. |
| `delete_block(p_character_id uuid, p_block_id text) returns bigint` | invoker | Removes the block. |
| `move_block(p_character_id uuid, p_block_id text, p_section_id text, p_before_block_id text default null) returns bigint` | invoker | Changes the block's `section` and its position in the array. |
| `set_sections(p_character_id uuid, p_sections jsonb) returns bigint` | invoker | Replaces the ordered sections list (rename, reorder, add). It rejects removing a section that still has blocks; the client moves or deletes them first. |
| `replace_sheet(p_character_id uuid, p_sections jsonb, p_blocks jsonb, p_name text default null) returns bigint` | invoker | Whole-sheet write, used only by JSON import and "reset to template" after an explicit confirm. |
| `assign_character(p_character_id uuid, p_user_id uuid) returns void` | definer | GM only. The target user must be a member of the same session. |
| `set_spotlight(p_session_id uuid, p_character_id uuid default null, p_block_id text default null, p_scene_aspect_id uuid default null) returns jsonb` | definer | GM only. With all targets null it clears the spotlight. Otherwise the target must be in that session and be an `aspect` or `consequence` block with a non-empty value, or a scene aspect (`invalid_spotlight`). Writes `sessions.spotlight` with a server `set_at = now()` and the GM's `user_id`. Returns the new value. `spotlight` is not in the GM's column grant, so it can only change through this function. |
| `reveal_roll(p_roll_id uuid) returns rolls` | definer | GM of the roll's session only. Sets `is_hidden = false`, `revealed_at = now()`. The row becomes visible to players under RLS and reaches them as a realtime UPDATE. |

All block RPCs lock the character row (`update ... where id = $1`), so concurrent operations on one sheet are serialised. Each rebuilds the array with `jsonb_array_elements ... with ordinality` / `jsonb_agg ... order by`.

Errors are raised with `raise exception using errcode = 'P0001', message = '<code>'`, where `<code>` is one of `not_authenticated`, `not_member`, `not_gm`, `invalid_invite`, `weak_gm_code`, `gm_code_taken`, `rate_limited`, `invalid_spotlight`, `block_not_found` or `invalid_block`. The client maps them to friendly messages.

---

## 5. Character sheet format

### 5.1 Sections
`characters.sections` is an ordered array:

```json
[
  { "id": "s_aspects",  "title": "Aspects" },
  { "id": "s_skills",   "title": "Skills" },
  { "id": "s_stress",   "title": "Stress" },
  { "id": "s_conseq",   "title": "Consequences" },
  { "id": "s_stunts",   "title": "Stunts" },
  { "id": "s_notes",    "title": "Notes" }
]
```

Whether a section card is collapsed is a per-device preference stored in localStorage, not in the database.

### 5.2 Blocks
`characters.blocks` is an ordered array. A block's position in the array decides its order within its section. Sections render in `sections` order; a block whose `section` doesn't match any section goes into a trailing "Other" group.

Common fields:

| Field | Type | Notes |
|---|---|---|
| `id` | string | `b_` + 10 random base36 chars, generated client-side; unique within the sheet |
| `type` | string | one of the types below |
| `label` | string | shown as the block title (may be empty) |
| `value` | type-specific | the editable payload |
| `section` | string | a `sections[].id` |
| `hint` | string? | optional placeholder text |

The examples below cover each type.

**text**: free text; `multiline` controls the editor.
```json
{ "id": "b_k2j9x0aa1q", "type": "text", "label": "Description", "value": "A wiry ex-courier with a prosthetic arm.", "section": "s_notes", "multiline": true }
```

**aspect**: a phrase. `role` is optional and only affects styling and GM card ordering.
```json
{ "id": "b_7f3mqp0ze2", "type": "aspect", "label": "High Concept", "value": "Disgraced Knight of the Silver Order", "section": "s_aspects", "role": "high_concept" }
```
`role` ∈ `high_concept | trouble | other`.

**skill**: an integer rating (also used for FAE approaches). `rollable` defaults to `true`; tapping it in Play mode rolls 4dF + value.
```json
{ "id": "b_fight00001", "type": "skill", "label": "Fight", "value": 3, "section": "s_skills", "rollable": true }
```

**stress**: `value` is an array of boxes. In Core and Accelerated a box's `size` is the shift value it absorbs; in Condensed every box has size 1.
```json
{ "id": "b_physstress", "type": "stress", "label": "Physical", "section": "s_stress",
  "value": [ { "size": 1, "checked": false }, { "size": 2, "checked": true }, { "size": 3, "checked": false, "disabled": true } ] }
```
`disabled` marks a box that is shown greyed until unlocked (e.g. by a high Physique); it can't be checked in Play mode.

**consequence**: `label` is the severity name, `value` the consequence aspect text (empty means free), `shift` the stress it absorbs. `free_invokes` tracks the free invoke the inflicting side gets.
```json
{ "id": "b_mildconseq", "type": "consequence", "label": "Mild", "value": "Bruised Ribs", "section": "s_conseq", "shift": 2, "free_invokes": 1 }
```

**counter**: an integer with optional `max` and optional `refresh` (the value a "Refresh" button resets it to).
```json
{ "id": "b_ammo000001", "type": "counter", "label": "Ammo", "value": 4, "section": "s_notes", "max": 6, "refresh": 6 }
```

**number**: a plain number with no limits (e.g. Refresh shown as a block in a custom sheet, or wealth).
```json
{ "id": "b_wealth0001", "type": "number", "label": "Silver", "value": 120, "section": "s_notes" }
```

**image**: `value` is an `https://` URL, rendered with `loading="lazy"` and `referrerpolicy="no-referrer"`. Other schemes are rejected.
```json
{ "id": "b_portrait01", "type": "image", "label": "Portrait", "value": "https://example.com/knight.png", "section": "s_notes", "alt": "Portrait of the knight" }
```

**separator**: a visual divider; `label` is an optional sub-heading. `value` is always `null`.
```json
{ "id": "b_sep0000001", "type": "separator", "label": "Gear", "value": null, "section": "s_notes" }
```

### 5.3 Fate points and refresh
Fate points and refresh are columns on `characters`, not blocks. Fate points have a dedicated sticky-bar control and are what the GM's award/take buttons change, so they need atomic RPCs and a fixed place. Every template shows them in a fixed header strip ("Fate Points 3 · Refresh 3").

### 5.4 Validation
Shared between the client (`src/sheet/validate.ts`) and the RPCs (`validate_block(jsonb)` in SQL):
- `id` matches `^b_[a-z0-9]{6,32}$`; `type` is in the list above; `section` is a string.
- `value` types: text/aspect/consequence/image → string; skill/counter/number → number (skill and counter integers); stress → array of 0–20 `{size:int 1..10, checked:bool, disabled?:bool}`; separator → null.
- Limits: at most 300 blocks per sheet, strings up to 2000 characters, at most 30 sections.

### 5.5 Templates
Templates live in client code (`src/sheet/templates.ts`) and generate fresh ids on use. All templates start with fate points 3 and refresh 3.

| Template | Aspects | Skills | Stress | Consequences | Other |
|---|---|---|---|---|---|
| **Fate Core** | High Concept, Trouble, 3 × Aspect | 18 skills (Athletics, Burglary, Contacts, Crafts, Deceive, Drive, Empathy, Fight, Investigate, Lore, Notice, Physique, Provoke, Rapport, Resources, Shoot, Stealth, Will), all 0 | Physical [1,2,(3),(4)], Mental [1,2,(3),(4)]; boxes in brackets are disabled | Mild 2, Moderate 4, Severe 6, plus a disabled second Mild | Stunts (text ×3), Extras, Notes |
| **Fate Accelerated** | High Concept, Trouble, 3 × Aspect | 6 approaches (Careful, Clever, Flashy, Forceful, Quick, Sneaky), all 0 | Stress [1,2,3] | Mild 2, Moderate 4, Severe 6 | Stunts (text ×3), Notes |
| **Fate Condensed** | High Concept, Trouble, 3 × Aspect | 19 skills (Core list + Academics), all 0 | Physical [1,1,1,(1),(1),(1)], Mental [1,1,1,(1),(1),(1)] | Mild 2, Moderate 4, Severe 6 | Stunts (text ×3), Notes |
| **Blank** | — | — | — | — | Sections: Aspects, Notes; no blocks |

Export format (`.fate.json`):
```json
{ "format": "fate-table-sheet", "version": 1, "name": "Sir Aldric", "template": "core",
  "fate_points": 3, "refresh": 3, "sections": [ ... ], "blocks": [ ... ] }
```
Import validates the file, regenerates any duplicate ids, shows a preview count, asks for confirmation, then calls `replace_sheet`.

---

## 6. Sheet UI

### 6.1 Play mode (default)
- Single column, one card per section. Card headers are tappable to collapse; skill sections are collapsed by default on phones if they have more than 8 blocks.
- Tapping a block value opens a **bottom sheet** with a large input:
  - text, aspect, consequence → textarea; image → URL field.
  - skill, number, counter → big −/+ steppers plus a numeric field.
- Stress boxes toggle on tap with no sheet. Counters show inline −/+.
- Tapping a skill's name or its die icon rolls (§7). Long-press, or the pencil icon, edits its value instead.
- Every touch target is at least 44 × 44 px.

### 6.2 Edit mode
- Toggled from the menu. Layout becomes editable; values stay editable.
- Each block has a dnd-kit drag handle. Blocks can be dropped within a section or into another section. Each section card also has a handle to reorder sections. Pointer, touch and keyboard sensors are enabled, and the touch sensor uses an activation delay so scrolling still works.
- Per block: change label, change type (only where the value converts cleanly, e.g. number ↔ skill ↔ counter, text ↔ aspect), type-specific fields (e.g. add or remove stress boxes, `max`/`refresh`, consequence `shift`), and delete with an undo toast.
- Per section: rename, delete (only when empty, or with "delete section and its blocks"), and "Add block" with a type picker.
- Sheet menu: rename character, apply template (replaces the sheet after a confirm), export JSON, import JSON.

### 6.3 Saving model (per block)
- Every edit is one block-level RPC (§4.4); the client never writes the whole `blocks` array except for import or template reset.
- Optimistic updates: the change is applied locally right away and an operation `{ opId, rpc, args }` goes into the **pending queue**. The queue is sent in order, one at a time per character.
- Text inputs save when the bottom sheet's "Done" button is pressed or the sheet is dismissed; steppers are debounced by 400 ms and collapsed into a single delta.
- Incoming realtime rows with `version` ≤ the local version are ignored. Newer rows replace the server copy, and any still-pending local operations are re-applied on top so the UI never flickers back.
- On RPC failure: offline errors leave the operation queued (§9.3). Permission or validation errors drop the operation, roll back to the server copy and show an error toast.

---

## 7. Dice

### 7.1 Server-decided rolls
1. The client calls `roll_dice(...)`. The RPC returns the inserted `rolls` row.
2. Every client in the session (the roller included) receives the INSERT over realtime.
3. Each client plays the animation for that row, landing on `faces`. The roller starts the animation from the RPC response straight away and de-duplicates the realtime copy by `id`.
4. Rolls that arrive more than 10 s after `created_at`, e.g. after a reconnect, go into the log without animating.

Rolling needs a connection; the Roll button and the floating 4dF button (§7.5) are disabled offline.

### 7.2 Animation (CSS 3D)
- Four cubes (`transform-style: preserve-3d`), each with faces `+`, `+`, blank, blank, `−`, `−` on opposite pairs.
- The cubes are drawn in the roller's colour (`rolls.roller_color`, §7.8), so everyone can tell at a glance whose roll is tumbling.
- Each die's final rotation is the face's base rotation plus whole extra turns (`360° × n`) on X and Y, plus a small Z jitter. A PRNG seeded from the roll `id` and the die index picks the turns and jitter, so every client shows the same tumble as well as the same result.
- About 1.4 s with `cubic-bezier(.2,.7,.2,1)` and a 60 ms stagger per die. `prefers-reduced-motion` skips the tumble and shows the faces with a fade.
- When the last die lands: `navigator.vibrate?.([30, 40, 30])` if available (feature-detected, which means a no-op on iOS), then the result appears.

### 7.3 Result text and ladder
`"<Roller>: <dice> <Label> <skill> [+ bonus] = <Ladder> (<total>)"`, e.g. **"+2 Fight +3 = Superb (+5)"** (the brief's example, "+2 Fight +3 = Great (+4)", doesn't add up, since +2 + 3 = +5 = Superb). Signed numbers are always shown with a sign, and the bonus segment appears only when it isn't zero.

Ladder (`src/dice/ladder.ts`): -2 Terrible, -1 Poor, 0 Mediocre, +1 Average, +2 Fair, +3 Good, +4 Great, +5 Superb, +6 Fantastic, +7 Epic, +8 Legendary. Below -2 it reads "Terrible (−n)"; above +8 it reads "Legendary +k (n)", e.g. "Legendary +1 (+9)".

### 7.4 Roll dialog
The sticky bar's **Roll** button opens a sheet with: "Plain 4dF", a searchable list of the character's rollable skills, and a bonus stepper (−5…+5, e.g. for a +2 invoke declared before the roll). Tapping a skill on the sheet rolls it with bonus 0.

### 7.5 Floating 4dF button
- A circular floating action button (56 × 56 px, showing a die face) that does a **plain 4dF roll in one tap**: `roll_dice(session_id)` with no character, no skill and bonus 0. The result reads e.g. "Bea: +1 = Average (+1)".
- It appears on every session screen for every member: player sheet, GM screen and the roll log. That gives the GM a one-tap roll too, since the GM screen has no Roll button of its own.
- Position: fixed bottom-right with safe-area insets. On the player sheet it sits just above the sticky bottom bar (`bottom: bar height + 16px`); on other screens 16 px from the bottom edge. It never covers the bottom bar's controls.
- **Long-press** (500 ms) opens the roll dialog (§7.4) instead, for skill or bonus rolls.
- While a roll is being decided or animating, the button shows a spinner and ignores taps, which prevents double rolls. It is disabled (greyed, with an "Offline" tooltip) when offline, and hidden while a bottom sheet, the big result view or edit-mode drag is active.
- Accessible name "Roll 4dF". It can be focused from the keyboard, and `R` triggers it when focus isn't in an input.
- The bottom bar's **Roll** button stays: it opens the roll dialog for skill rolls, while the floating button is the fast plain roll.

### 7.6 Roll log
A right-hand drawer on desktop and a bottom drawer on phones, opened from the header or menu. It loads the latest 50 rolls on open, then appends live. Each entry shows the roller (name in their colour), faces as mini dice in the roller's colour, the breakdown, the ladder result and a relative time. Everyone in the session sees it.

### 7.7 Big result view
On phones, after any roll lands, a full-screen overlay tinted with the roller's colour shows the total and ladder name in huge type with the roller's name and skill, so the phone can be shown to the table. It closes on tap or after 4 s, and the roller can pin it open. It can be turned off for other people's rolls in settings.

---

### 7.8 Player colours
- Every member, GM included, has a colour from a fixed palette of 12: red, orange, amber, lime, green, teal, cyan, blue, indigo, violet, pink, slate. The palette uses keys, not hex values, so each one maps to a light and a dark shade pair in `src/ui/colors.ts` that keeps the die faces readable (at least 4.5:1 contrast between face and symbol) in both themes.
- **Picking**: a swatch row on the join screen and on create session, with the first unused colour pre-selected. Colours already taken in the session show a small initial, but they can still be chosen; duplicates are allowed, just discouraged. It can be changed any time from the menu (an `update` on your own `session_members` row).
- **Where it shows**: the dice (§7.2), the roll log, the big result view, an accent stripe on the player's sheet header and bottom bar, the border of their card on the GM screen, and the member list.
- Each roll stores `roller_color` as a snapshot, so changing colour later doesn't recolour old log entries.

### 7.9 Open and closed GM rolls
- **Session setting** `sessions.gm_roll_mode`: `open` (default) or `closed`. A GM toolbar toggle labelled "GM rolls: Open / Closed" sets it; it is saved and shared by every GM device.
- **Per-roll override**: the roll dialog (§7.4), when the GM opens it, has an "Open / Closed" switch preset from the session setting. The floating button (§7.5) always uses the session setting, and shows a small eye-slash badge when it is set to closed.
- **Open GM roll**: works like any other roll; everyone sees it animate and in the log.
- **Closed GM roll**:
  - Only GM devices receive the `rolls` row; RLS hides it from players, realtime included. GMs see the normal animation and a log entry marked "Hidden".
  - Players receive only the `hidden_roll` event. They see a short animation of four face-down dice in the GM's colour that never resolve, and a log entry "GM rolled behind the screen", with no faces, total or skill.
  - Players' phones show no big result view for it.
- **Reveal**: a hidden log entry on the GM side has a "Reveal" button that calls `reveal_roll`. Players then receive the real row. Their placeholder entry, matched by `roll_id`, turns into the full result, the dice animate onto the real faces, and a "Revealed" tag shows.
- Players' own rolls are always open.

## 8. GM screen

- **Desktop (≥ 1024 px)**: a responsive grid (`grid-cols-[repeat(auto-fill,minmax(280px,1fr))]`) with one compact card per character. Each card shows the character and player name, fate points with −/+ (award/take), all aspects, stress tracks (boxes toggle in place), filled consequences, and an "N empty" chip that expands the empty ones. Empty blocks are collapsed. "Open sheet" opens the full sheet with GM edit rights.
- **Phone**: a horizontal scroll-snap pager with one card per character, swipeable, with dots and name chips to jump between them. No library.
- **Scene aspects panel**: a list of scene/situation aspects, each with a free-invoke counter (−/+). The GM can add, edit, delete and drag to reorder. Players see the same panel read-only, collapsible above their sheet.
- **Floating 4dF button** (§7.5) for quick GM rolls, which follow the open/closed setting (§7.9).
- **Change GM code**: in the members panel, enter a new code twice → `change_gm_code`.
- **GM roll mode toggle**: Open / Closed in the toolbar (§7.9).
- Character cards have a border in the owning player's colour (§7.8).
- **GM fate point pool**: a big counter in the GM toolbar with −/+ and a "Reset to N" helper (N = number of PCs, the usual scene start).
- **Award/take**: −/+ on each card calls `adjust_fate_points(character, ±1)`. That inserts a `session_events` row, and the player gets a toast ("The GM gave you a fate point").
- **Members**: the invite link with copy and share (`navigator.share` when available), the list of members and their roles, kick, and "assign character to…".
- Everything updates live (§10).

---

### 8.1 Spotlight: GM highlights an aspect or consequence
When the GM presses an aspect, a consequence or a scene aspect, it is highlighted on every screen in the session, so the GM can point at it while saying "I'm compelling that" or "that's your free invoke".

**Data**: `sessions.spotlight`, set through `set_spotlight` (§4.4) and delivered by the existing `sessions` realtime subscription, so no new channel is needed. Because it is stored, a player who reloads or joins late still sees the current highlight.
```json
{ "kind": "block", "character_id": "8c1e…", "block_id": "b_7f3mqp0ze2", "set_at": "2026-11-25T20:14:03Z", "by": "a91f…" }
{ "kind": "scene_aspect", "scene_aspect_id": "3d0a…", "set_at": "2026-11-25T20:15:40Z", "by": "a91f…" }
```

**GM side**
- On the GM screen's character cards and in the scene aspects panel, **tapping an aspect or a filled consequence toggles the spotlight** on it. Editing those on a card moves to the pencil icon or a long-press.
- On a full sheet opened by the GM, aspects and consequences get a small spotlight icon button, because tapping the value still edits it there.
- Only one item is highlighted at a time. Pressing another moves the highlight, and pressing the highlighted one again clears it. A "Clear highlight" chip shows in the GM toolbar while one is active.
- Empty aspects and empty consequence slots can't be highlighted.

**Player screens: a pop-up**
- Every player gets a **pop-up card** over whatever they're looking at. Nothing scrolls, and no sections expand or move.
  - A dimmed backdrop, with a centred card ringed in the GM's colour (§7.8).
  - Header "★ The GM highlights".
  - The aspect or consequence text in large type, e.g. *Bruised Ribs*.
  - A subtitle saying whose it is: "Bea's mild consequence", "Your high concept", or "Scene aspect", plus free invokes if it has any.
- **Dismiss**: tap anywhere or press OK; it also closes by itself after 8 s. A dismissed highlight doesn't pop up again on that device; this is tracked by `set_at` in localStorage.
- **Changes**: if the GM moves the highlight, the open pop-up switches to the new item, or a new pop-up opens if it was closed. If the GM clears it or deletes the item, an open pop-up closes.
- **Not interrupting**: if a bottom-sheet editor or the big roll result is open, the pop-up waits until it closes. The pop-up doesn't take keyboard focus away from an input.
- **Late joiners / reload**: a highlight that is still active and not yet dismissed on that device pops up once.
- **Your own item**: a short vibration as well, where supported.
- Highlights older than 10 minutes (`set_at` + 10 min) are ignored, so a forgotten one doesn't pop up for someone joining later.

**GM devices**: no pop-up. The highlighted item on the GM screen gets a ring in the GM's colour, and the toolbar's "Clear highlight" chip shows what's active.

## 9. Mobile and PWA

### 9.1 Layout
- Designed and tested at 375 × 667 first. Single column, `max-w-screen-sm` centred on larger screens for players.
- **Sticky bottom bar** with safe-area padding (`env(safe-area-inset-bottom)`): fate points (− value +), a large **Roll** button, and a ☰ menu (edit mode, roll log, scene aspects, wake lock, shake-to-roll, theme, export/import, leave session).
- Bottom sheets: a portal plus a backdrop, drag-down or backdrop tap to dismiss, focus trapping, and the input auto-focused and kept above the keyboard with `visualViewport`.

### 9.2 PWA
- `vite-plugin-pwa` with `registerType: 'prompt'` (toast: "Update available — reload"), a manifest (name, short_name, theme and background colours, `display: standalone`, 192/512 and maskable icons), and precached app shell assets.
- The SPA falls back to `index.html` for navigation requests. Supabase API calls are never cached by the service worker; offline data is handled by the app (§9.3).

### 9.3 Offline
- **Cache**: the last-fetched session bundle (session, members, my characters, scene aspects, last 50 rolls) goes to localStorage under `fate.cache.<sessionId>` on every change. When offline or slow, the app renders from cache straight away.
- **Queue**: pending operations (§6.3) are saved to `fate.queue.<sessionId>`, so they survive a reload.
- **Reconnect**: on `online`, the Supabase realtime channel re-subscribing, or the tab becoming visible again, the app (1) flushes the queue in order, then (2) refetches the bundle, then (3) resumes realtime. Operations rejected while flushing are dropped and reported with a toast.
- An offline banner shows "Offline — N changes waiting".
- Conflict policy: last writer wins per block field (`update_block` merge) or per stress box. Deltas (`adjust_*`) commute, so nothing is lost.

### 9.4 Device features (all feature-detected, all opt-in from the menu)
- **Screen Wake Lock**: a toggle that calls `navigator.wakeLock.request('screen')` and re-acquires on `visibilitychange`. It is hidden if unsupported.
- **Shake to roll**: an "Enable shake to roll" button. On iOS it calls `DeviceMotionEvent.requestPermission()` from the tap. Then it listens for `devicemotion`: if acceleration including gravity, minus gravity, exceeds about 18 m/s² twice within 400 ms, it fires a plain roll or the last-used skill. There is a 2 s cooldown, and it pauses while a bottom sheet is open.
- **Haptics**: `navigator.vibrate` on dice landing (§7.2) and on fate point changes.
- **Toasts**: scene aspect added (everyone), fate point awarded or taken (the affected player), member joined (GM), errors, and "update available".
- Wake lock, device motion and service workers need a **secure context** (HTTPS). `http://192.168.x.x` from `vite --host` works for layout testing, but those three features need HTTPS (see Open Questions).

---

## 10. Realtime

- There is one channel per session: `session:<id>`, with `postgres_changes` listeners filtered by `session_id=eq.<id>` for `characters`, `rolls`, `scene_aspects`, `session_events` and `session_members`, and `id=eq.<id>` for `sessions`.
- A single `SessionProvider` holds the session state in a reducer and applies events: insert/update replaces by id (characters are gated by `version`), and delete removes by id.
- Character tables use `replica identity full` so DELETE payloads include `session_id` for filtering.
- When the channel reaches `SUBSCRIBED` after being disconnected, the app runs the reconnect sequence (§9.3).

---

## 11. App structure and routes

| Route | Screen |
|---|---|
| `/` | Home: resume last session, Join with code, GM code textbox (reclaim or create) |
| `/join/:code` | Join form (display name) |
| `/s/:sessionId` | Redirects by role: GM → `/s/:id/gm`, player → their character, or to character creation |
| `/s/:sessionId/new-character` | Template picker + name |
| `/s/:sessionId/c/:characterId` | Character sheet (play/edit) |
| `/s/:sessionId/gm` | GM screen |
| `*` | Not found |

```
src/
  main.tsx, App.tsx, routes.tsx
  lib/supabase.ts         # client, anonymous sign-in
  lib/errors.ts           # RPC error code → message
  lib/storage.ts          # localStorage helpers (try/catch)
  session/                # SessionProvider, realtime, cache, queue
  sheet/                  # types.ts, templates.ts, validate.ts, ops.ts, components/
  dice/                   # ladder.ts, prng.ts, Dice3D.tsx, RollLog.tsx, BigResult.tsx
  gm/                     # GmScreen.tsx, CharacterCard.tsx, ScenePanel.tsx
  ui/                     # BottomSheet, Toast, Button, Stepper, Drawer, icons
  device/                 # wakeLock.ts, shake.ts, haptics.ts
supabase/
  migrations/0001_schema.sql, 0002_rls.sql, 0003_rpcs.sql, 0004_realtime.sql
scripts/rls-test.mjs
```

---

## 12. Theming, accessibility and errors
- Dark mode follows the system by default, with an override (light / dark / system) in the menu stored in localStorage. Colours are defined as CSS variables used by Tailwind.
- Contrast is at least 4.5:1 for text. Focus rings are visible. Dice results are announced through an `aria-live` region.
- Empty states: no characters yet (GM sees the invite link), an empty section ("Add a block" in edit mode), no rolls yet, no scene aspects.
- Errors: RPC errors are mapped to plain language. A top-level error boundary has a "Reload" button. Network failures are queued or retried rather than shown as raw errors.

---

## 13. Testing
- `npm run typecheck` (`tsc -b --noEmit`) and `npm run build` must pass at the end of every slice.
- **RLS test**: `scripts/rls-test.mjs` uses `@supabase/supabase-js` with the project URL and anon key. It signs in three anonymous users (a GM of session A, a player of A, and a player of session B) and asserts:
  - The B player cannot select session A, its members, characters, rolls or scene aspects (0 rows).
  - Player A2 cannot update or delete player A1's character, or call `update_block` on it (0 rows / error).
  - A player cannot insert into `rolls` directly, cannot read `session_secrets`, and cannot update `sessions`.
  - A player cannot create or edit scene aspects.
  - The GM of A can update A1's character and adjust its fate points, and cannot read session B.
  - `claim_gm` returns `null` for an unknown code and grants nothing; the 11th failure within 10 minutes raises `rate_limited`.
  - `create_session` with a code another session already uses raises `gm_code_taken`, and with `short` it raises `weak_gm_code`.
  - A closed GM roll in session A is invisible to player A1 (0 rows); A1 does see the `hidden_roll` event. After `reveal_roll`, A1 can select it.
  - A player calling `roll_dice(..., p_hidden => true)` gets `not_gm`; a player can't call `reveal_roll` or change `gm_roll_mode`.
  - A player can change their own `color` but not another member's.
  - A player calling `set_spotlight`, or updating `sessions.spotlight` directly, is refused; the GM's `set_spotlight` on an aspect in another session raises `invalid_spotlight`.
  It prints PASS/FAIL per check and exits non-zero on any failure. It needs anonymous sign-ins enabled on the project.
- Manual test scripts for each slice are in PLAN.md.

---

## 14. Open questions (defaults in **bold**; the build uses them unless you say otherwise)
1. **Block storage**: **a jsonb array on `characters` with block-level RPCs** (as the brief says) vs. a row per block in a `character_blocks` table (smaller realtime payloads, simpler RLS, but the sheet is no longer one jsonb document).
2. **Visibility**: **players can read other players' sheets (read-only)** vs. players see only their own sheet plus the GM screen's public info.
3. **HTTPS on the phone during development**: **test device features (wake lock, shake, PWA install) on a Vercel preview deploy** vs. adding the dev dependency `@vitejs/plugin-basic-ssl` so `vite --host` serves HTTPS.
4. **Dev dependencies**: should I add `vitest` for unit tests of the ladder, PRNG, block ops and validation? Should I add the `supabase` CLI as a dev dependency so `npx supabase db push` works? **Default: neither; migrations are pasted into the SQL editor or run with a globally installed CLI.**
5. **Fate point awards**: **award and take don't touch the GM pool** (the pool is the GM's own counter) vs. awarding to a player decrements the GM pool.
6. **NPCs**: **out of scope for v1**; the GM can create a character they own, and it shows on the GM screen with an "NPC" tag.
