# Fate Table — Specification

A web app for running Fate RPG sessions (Fate Core, Fate Accelerated, Fate Condensed). It has block-based character sheets, server-decided 4dF dice with a synced animation, a live GM screen, and a GM workspace for scenes (narrative or zones) and NPCs. The player sheet is mobile-first and installable as a PWA.

---

## 1. Goals and non-goals

**Goals**
- No accounts. Everyone signs in with Supabase anonymous auth without noticing.
- A GM opens a session with a GM code of their choosing, invites players with a link, and runs the game from a live GM screen.
- Players keep a flexible, block-based character sheet on their phone and can read everyone else's sheet.
- Dice results are decided once on the server, and every client shows the same faces.
- The GM prepares and runs scenes: narrative lists of aspects, or a zones board of draggable index cards and tokens.
- All shared state is live through Supabase Realtime.

**Non-goals for v1**
- Email or OAuth accounts, or linking an anonymous user to a real account.
- A dice physics engine (we use CSS 3D only).
- Grid or battle maps, line of sight, or measuring. The zones board is free-form cards with no snapping.
- Chat, voice, or a rules engine. The app tracks state; people apply the rules.
- Live streaming of drags. Others see a card or token move when it's dropped.
- Cleaning up old anonymous users or sessions.

---

## 2. Stack

| Concern | Choice |
|---|---|
| Build | Vite + React 18 + TypeScript (strict) |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite`), `dark` variant switched by a class on `<html>` |
| Routing | React Router (`react-router-dom`) |
| Backend | Supabase: Postgres, anonymous auth, RLS, Realtime, RPCs, Vault |
| Drag and drop | `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` (lists *and* the free-form zones board) |
| PWA | `vite-plugin-pwa` (Workbox `generateSW`) |
| Deploy | Vercel (static SPA with a rewrite to `index.html`) |
| Migrations | Plain SQL in `/supabase/migrations/*.sql`, applied with the Supabase CLI |
| Dev only | `vitest` (unit tests), `supabase` (CLI, for `db push`) |

There are no other dependencies. Icons are inline SVG. Toasts, bottom sheets, the swipe view, the dice and the board's zoom are hand-written. Any extra dependency needs approval first.

---

## 3. Identity, sessions and access

### 3.1 Anonymous auth
- On first load the app calls `supabase.auth.signInAnonymously()` if there is no Supabase auth session. The Supabase client keeps its own auth session in localStorage, so the same anonymous `auth.uid()` survives reloads on that device.
- Every row ties back to `auth.uid()`. A "user" means one browser on one device.

### 3.2 Codes
- **Invite code**: 6 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0/O/1/I), e.g. `K7QPMX`. It is not secret; anyone with it can join as a player. Invite URL: `https://<host>/join/K7QPMX`.
- **GM code**: chosen by the GM and typed into a textbox. **Entering a code that no session uses yet is how a session is created**; entering it again later, on any device, makes you that session's GM.
  - **Normalisation** (client and server): trim, collapse inner whitespace to one space, lower-case. `Silver Order Falls` and `silver  order falls` are the same code.
  - **Strength rule** (checked in the client and again in the RPC): at least 10 characters after normalisation, not just one repeated character, and not on a short built-in blocklist (`password…`, `fatecore…`, `1234567890`, and so on). A **"Suggest one"** button fills in 4 random words from a word list bundled in the app, e.g. `ember-lantern-otter-quarry`, which gives about 41 bits of entropy.
  - **Uniqueness**: a code belongs to exactly one session (unique index on its hash).
  - **Storage**: only `hmac(normalised_code, pepper, 'sha256')` is stored, in `session_secrets`, which no client role can read. The pepper is a random 32-byte secret that the migration creates in Supabase Vault (`gm_code_pepper`); it is never in a table.
    - A deterministic keyed hash, rather than bcrypt, lets the server find the session from the code alone.
    - The pepper means a leaked table can't be brute-forced without the Vault secret too.
  - **Guessing protection**: failed `claim_gm` attempts are recorded per user. More than 10 failures in 10 minutes gives `rate_limited`. Supabase's own limit on anonymous sign-ins per IP caps how many fresh users one attacker can make.
  - The app never stores the GM code. After creation it reminds the GM to remember or write it down.
- Code checks run server-side in `SECURITY DEFINER` RPCs.

### 3.3 Flows
1. **GM: enter a GM code** (`/` → the "GM code" textbox → Continue). The app calls `claim_gm(code)`:
   - **The code matches a session**: you become its GM and go to the GM screen. This is also how a GM reclaims access on another device.
   - **No session uses it**: the same card expands to "No session uses this code yet. Create one?" with fields for session name, your display name and your colour (§7.8) → `create_session(code, …)` → a screen with the invite link (copy and share) → GM screen.
   - **Code too weak**: an inline message with the rule, plus the "Suggest one" button.
   - A new code never silently creates a session, because there's a confirm step. So a typo while reclaiming can't create an unwanted session.
   - Several devices can be GM at once; reclaiming does not revoke the others. If the device's user was already a player in the session, they are promoted to GM.
2. **Join** (`/join/:code`, or type the code on `/`): enter a display name and pick a colour (§7.8) → `join_session()` → on first entry, pick a template and name your character → player sheet.
3. **Resume**: localStorage key `fate.last` = `{ sessionId, inviteCode, role, displayName }`. On launch, if it exists and the user is still a member (checked with a select on `session_members`), the app goes straight in. If not, the key is cleared and the home screen is shown.

### 3.4 Lost identity
If a player clears site data, they get a new anonymous user and lose ownership of their character. The GM can reassign any PC to any member with `assign_character()`. The GM sees an "Orphaned" badge on PCs whose owner is no longer a member.

---

## 4. Database schema

All tables live in `public`. Extensions: `pgcrypto`, plus Supabase Vault (`supabase_vault`, on by default in hosted projects). Every table has RLS enabled.

Shared triggers:
- `touch_updated_at` sets `updated_at = now()` before update.
- `bump_version` sets `version = old.version + 1` before update.
- `copy_session_id` sets `session_id` from the parent row before insert, and rejects any change to it on update.

Every mutable table carries `version` and `updated_at`.

**Why sheets are rows (modularity):** a character's sections and blocks are rows in `sheet_sections` and `sheet_blocks`, not one jsonb document.
- Each block is addressable on its own. Saves, realtime events and RLS checks are per block.
- PCs and NPCs share the same block machinery.
- New block types only need a new `type` value plus validation; there is no schema change.

A block's type-specific fields still live in jsonb (`value`, `props`). The logical "a sheet is an ordered list of blocks" format (§5) is what the client works with and what export/import uses.

### 4.1 Tables

```sql
-- sessions -----------------------------------------------------------------
create table sessions (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (char_length(name) between 1 and 80),
  invite_code     text not null unique check (invite_code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  gm_fate_points  int  not null default 0 check (gm_fate_points >= 0),
  gm_roll_mode    text not null default 'open' check (gm_roll_mode in ('open','closed')), -- §7.9
  active_scene_id uuid,      -- FK to scenes(id) on delete set null; added after scenes. The scene players see (§8.3)
  spotlight       jsonb,     -- current GM highlight or null (§8.2); written only by set_spotlight
  created_by      uuid references auth.users(id) on delete set null,
  version         bigint not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- session_secrets: one row per session; NO policies -> unreadable by clients
create table session_secrets (
  session_id   uuid primary key references sessions(id) on delete cascade,
  gm_code_hash text not null unique        -- hex(hmac(normalised code, vault pepper, 'sha256'))
);

-- gm_code_attempts: failed claim_gm calls, for rate limiting; NO policies
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
                 ('red','orange','amber','lime','green','teal','cyan','blue','indigo','violet','pink','slate')), -- §7.8
  joined_at    timestamptz not null default now(),
  primary key (session_id, user_id)
);
create index on session_members (user_id);

-- characters (PCs and NPCs) ------------------------------------------------
create table characters (
  id                 uuid primary key default gen_random_uuid(),
  session_id         uuid not null references sessions(id) on delete cascade,
  kind               text not null default 'pc' check (kind in ('pc','npc')),
  owner_id           uuid references auth.users(id) on delete set null,  -- PCs: the player; NPCs: null (owned by the GM role)
  name               text not null default 'Unnamed' check (char_length(name) <= 80),
  template           text not null check (template in ('core','accelerated','condensed','blank','npc')),
  fate_points        int  not null default 3 check (fate_points >= 0),
  refresh            int  not null default 3 check (refresh >= 0),
  visible_to_players boolean not null default false,  -- NPCs only; PCs are always visible to members
  position           double precision not null default 0,  -- NPC roster order
  version            bigint not null default 1,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (kind = 'pc' or owner_id is null)
);
create index on characters (session_id);

-- sheet_sections -----------------------------------------------------------
create table sheet_sections (
  character_id uuid not null references characters(id) on delete cascade,
  id           text not null check (id ~ '^s_[a-z0-9]{3,32}$'),
  session_id   uuid not null references sessions(id) on delete cascade,   -- copied by trigger, for realtime filters
  title        text not null check (char_length(title) between 1 and 60),
  position     double precision not null,
  version      bigint not null default 1,
  updated_at   timestamptz not null default now(),
  primary key (character_id, id)
);
create index on sheet_sections (session_id);

-- sheet_blocks -------------------------------------------------------------
create table sheet_blocks (
  character_id uuid not null references characters(id) on delete cascade,
  id           text not null check (id ~ '^b_[a-z0-9]{6,32}$'),
  session_id   uuid not null references sessions(id) on delete cascade,   -- copied by trigger
  section_id   text not null,
  type         text not null check (type in
                 ('text','aspect','skill','stress','consequence','counter','number','image','separator')),
  label        text not null default '' check (char_length(label) <= 200),
  value        jsonb,                                  -- type-specific (§5.2), checked by validate_block trigger
  props        jsonb not null default '{}'::jsonb,     -- type-specific extra fields (§5.2)
  position     double precision not null,              -- order within the section
  version      bigint not null default 1,
  updated_at   timestamptz not null default now(),
  primary key (character_id, id),
  foreign key (character_id, section_id) references sheet_sections(character_id, id)
    on update cascade                                  -- deleting a non-empty section fails (use delete_section)
);
create index on sheet_blocks (session_id);
create index on sheet_blocks (character_id, section_id, position);

-- rolls (insert-only through roll_dice) ------------------------------------
create table rolls (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references sessions(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete set null,
  character_id uuid references characters(id) on delete set null,
  roller_name  text not null,             -- display name snapshot ("Bea", or "GM · Thug" for NPC rolls)
  roller_color text not null,             -- colour snapshot
  is_hidden    boolean not null default false,  -- closed GM roll (§7.9)
  revealed_at  timestamptz,
  label        text,                      -- e.g. 'Fight'; null for a plain roll
  skill_value  int  not null default 0,   -- read server-side from the skill block
  bonus        int  not null default 0,
  faces        smallint[] not null check (array_length(faces,1) = 4 and faces <@ array[-1,0,1]::smallint[]),
  dice_total   int  not null,
  total        int  not null,
  created_at   timestamptz not null default now()
);
create index on rolls (session_id, created_at desc);

-- scenes -------------------------------------------------------------------
create table scenes (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 80),
  kind       text not null default 'narrative' check (kind in ('narrative','zones')),
  position   double precision not null default 0,   -- order in the GM's scene list
  version    bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on scenes (session_id, position);
alter table sessions add foreign key (active_scene_id) references scenes(id) on delete set null;

-- scene_zones: index cards on a zones board ---------------------------------
create table scene_zones (
  id         uuid primary key default gen_random_uuid(),
  scene_id   uuid not null references scenes(id) on delete cascade,
  session_id uuid not null references sessions(id) on delete cascade,   -- copied by trigger
  title      text not null default 'Zone' check (char_length(title) <= 60),
  color      text check (color is null or color in ('red','orange','amber','lime','green','teal','cyan','blue','indigo','violet','pink','slate')),
  x          real not null check (x between 0 and 1600),   -- board units (§8.3.2)
  y          real not null check (y between 0 and 1000),
  w          real not null default 300 check (w between 160 and 1600),
  h          real not null default 200 check (h between 120 and 1000),
  z          int  not null default 0,                       -- stacking; raised on drag
  version    bigint not null default 1,
  updated_at timestamptz not null default now()
);
create index on scene_zones (scene_id);

-- scene_aspects: scene-level (zone_id null) or inside a zone ----------------
create table scene_aspects (
  id           uuid primary key default gen_random_uuid(),
  scene_id     uuid not null references scenes(id) on delete cascade,
  session_id   uuid not null references sessions(id) on delete cascade, -- copied by trigger
  zone_id      uuid references scene_zones(id) on delete set null,     -- deleting a zone keeps its aspects at scene level
  text         text not null check (char_length(text) between 1 and 200),
  free_invokes int  not null default 0 check (free_invokes between 0 and 99),
  position     double precision not null default 0,
  version      bigint not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on scene_aspects (scene_id, zone_id, position);

-- scene_tokens: PC/NPC (or free) markers on a zones board -----------------
create table scene_tokens (
  id           uuid primary key default gen_random_uuid(),
  scene_id     uuid not null references scenes(id) on delete cascade,
  session_id   uuid not null references sessions(id) on delete cascade, -- copied by trigger
  character_id uuid references characters(id) on delete set null,       -- null = free token ("Car", "Bomb")
  label        text not null check (char_length(label) between 1 and 40),  -- stored, so hidden NPCs don't leak their sheet
  color        text check (color is null or color in ('red','orange','amber','lime','green','teal','cyan','blue','indigo','violet','pink','slate')),
                                       -- null on a PC token = use the owner's member colour
  x            real not null check (x between 0 and 1600),
  y            real not null check (y between 0 and 1000),
  version      bigint not null default 1,
  updated_at   timestamptz not null default now()
);
create index on scene_tokens (scene_id);

-- session_events: toasts and refetch hints (insert-only via RPCs/triggers) -----
create table session_events (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null references sessions(id) on delete cascade,
  kind                text not null check (kind in ('scene_aspect_added','fate_point_awarded','fate_point_taken',
                        'member_joined','hidden_roll','visibility_changed')),
  target_character_id uuid references characters(id) on delete cascade,
  payload             jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);
create index on session_events (session_id, created_at desc);
```

Other triggers:
- `characters_guard` (before update): rejects changes to `session_id` and `kind`, and rejects `owner_id` changes unless the caller is the session's GM.
- `validate_block` (before insert/update on `sheet_blocks`): checks `value` and `props` against §5.4 and raises `invalid_block`.
- `sheet_limits` (before insert): at most 300 blocks and 30 sections per character.
- `scene_aspect_added_event` (after insert on `scene_aspects`): inserts a session event only when the aspect's scene is the active scene.
- `member_joined_event` (after insert on `session_members`, role `player`).
- `visibility_changed_event` (after update of `characters.visible_to_players`, and of `sessions.active_scene_id`): inserts `visibility_changed`. Players can't receive the update itself once a row is hidden from them, so this event tells clients to drop or refetch it (§10).
- `same_session_guard`: `active_scene_id`, `scene_aspects.zone_id` and `scene_tokens.character_id` must point to rows in the same session/scene.

Realtime: the migration adds every table above, except `session_secrets` and `gm_code_attempts`, to the `supabase_realtime` publication.

### 4.2 Helper functions
`SECURITY DEFINER`, `STABLE`, `search_path = public`. They exist so policies can check access without recursive RLS.

```sql
is_session_member(p_session_id uuid)     returns boolean  -- auth.uid() has any role in the session
is_session_gm(p_session_id uuid)         returns boolean  -- auth.uid() has role 'gm'
can_view_character(p_character_id uuid)  returns boolean  -- member, and (kind = 'pc' or visible_to_players or gm)
can_edit_character(p_character_id uuid)  returns boolean  -- (kind = 'pc' and owner_id = auth.uid()) or gm
can_view_scene(p_scene_id uuid)          returns boolean  -- gm of its session, or member and it is sessions.active_scene_id
```

### 4.3 Row-level security

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `sessions` | `is_session_member(id)` | — (RPC) | `is_session_gm(id)`; column grant `name`, `gm_fate_points`, `gm_roll_mode`, `active_scene_id` | `is_session_gm(id)` |
| `session_secrets`, `gm_code_attempts` | — | — | — | — (no policies; all privileges revoked) |
| `session_members` | `is_session_member(session_id)` | — (RPC) | own row; column grant `display_name`, `color` | own row (leave) or GM (kick) |
| `characters` | `can_view_character(id)` | PC: member and `owner_id = auth.uid()`; NPC: GM | `can_edit_character(id)`; column grant `name`, `fate_points`, `refresh`, `template`, `visible_to_players` (NPC only, enforced by trigger), `position`, `owner_id` (GM, by trigger) | `can_edit_character(id)` |
| `sheet_sections`, `sheet_blocks` | `can_view_character(character_id)` | `can_edit_character(character_id)` | `can_edit_character(character_id)` | `can_edit_character(character_id)` |
| `rolls` | member and (`not is_hidden` or GM) | — (RPC only, so results can't be forged) | — (`reveal_roll`) | — |
| `scenes` | `can_view_scene(id)` | GM | GM | GM |
| `scene_zones`, `scene_aspects`, `scene_tokens` | `can_view_scene(scene_id)` | GM | GM | GM |
| `session_events` | `is_session_member(session_id)` | — (RPC/trigger) | — | — |

So:
- A member can read only the sessions they belong to. Inside a session, players can **read** every PC sheet, but **edit only their own**.
- Players never see NPCs unless the GM marks them visible, never see scenes other than the active one, and never see closed GM rolls.
- The GM can read and change everything in their session.
- `anon` (the role before sign-in) gets nothing. Every grant is to `authenticated`, and anonymous Supabase users carry that role.

### 4.4 RPCs

`SECURITY DEFINER` functions bypass RLS, so each one checks authorization itself. `SECURITY INVOKER` functions run under RLS. All of them set `search_path = public, extensions`. `execute` is revoked from `public`/`anon` and granted to `authenticated`.

**Sessions and members**

| Function | Mode | Behaviour |
|---|---|---|
| `create_session(p_gm_code text, p_name text, p_display_name text, p_color text default null) returns table(session_id uuid, invite_code text)` | definer | Normalises the code and enforces the strength rule (`weak_gm_code`). Generates a unique invite code. Inserts the session, the secret (peppered HMAC) and a GM member row. If the hash already exists, it raises `gm_code_taken` (a race) and the client retries `claim_gm`. It also creates a first narrative scene, "Scene 1", and makes it active. |
| `claim_gm(p_gm_code text) returns uuid` | definer | Checks the rate limit (`rate_limited`), normalises and hashes the code, then looks it up. **No match**: records an attempt and returns `null`. **Match**: upserts the member as `gm` (`display_name` defaults to 'GM') and returns `session_id`. |
| `change_gm_code(p_session_id uuid, p_new_code text) returns void` | definer | GM only. Strength and uniqueness checks, then replaces the hash. |
| `join_session(p_invite_code text, p_display_name text, p_color text default null) returns uuid` | definer | Raises `invalid_invite` if the code matches nothing. Inserts the member as `player` with `p_color`, or the first unused palette colour. A repeat join updates the name and colour and keeps the role. |
| `assign_character(p_character_id uuid, p_user_id uuid) returns void` | definer | GM only. The character must be a PC and the target a member of the same session. |

**Sheets** (all invoker; RLS via `can_edit_character`). Plain inserts and deletes of blocks and sections are ordinary PostgREST table writes.

| Function | Behaviour |
|---|---|
| `patch_block(p_character_id uuid, p_block_id text, p_patch jsonb) returns sheet_blocks` | Applies any of `label`, `value`, `type`, `section_id`, `position`; `props` is shallow-merged (`props || patch.props`). Raises `block_not_found`. Every edit to an existing block goes through this, so the offline queue has one operation shape. |
| `set_stress_box(p_character_id uuid, p_block_id text, p_index int, p_checked boolean) returns sheet_blocks` | Sets one box, so toggles from two people don't clobber each other. |
| `adjust_block_value(p_character_id uuid, p_block_id text, p_delta numeric) returns sheet_blocks` | Atomic increment for `skill`, `counter` and `number`. Counters are clamped to `0..props.max`. |
| `delete_section(p_character_id uuid, p_section_id text, p_with_blocks boolean default false) returns void` | Raises `section_not_empty` unless the section is empty or `p_with_blocks` is true. |
| `rebalance_positions(p_character_id uuid) returns void` | Renumbers section and block positions to steps of 1024. The client calls it when a midpoint gap drops below 1e-6. |
| `replace_sheet(p_character_id uuid, p_sheet jsonb) returns void` | Whole-sheet write in one transaction: name, fate points, refresh, sections and blocks in the §5.6 export format. Used only for import and "apply template" after a confirm. |
| `adjust_fate_points(p_character_id uuid, p_delta int) returns int` | Atomic `greatest(0, fate_points + delta)`. If the caller is the GM and doesn't own the character, an internal definer helper also inserts `fate_point_awarded`/`fate_point_taken`. |
| `adjust_gm_pool(p_session_id uuid, p_delta int) returns int` | Atomic `greatest(0, gm_fate_points + delta)`, GM only. Manual only: nothing else ever changes the pool. |

**Dice and table** (definer)

| Function | Behaviour |
|---|---|
| `roll_dice(p_session_id uuid, p_character_id uuid default null, p_block_id text default null, p_bonus int default 0, p_label text default null, p_hidden boolean default null) returns rolls` | Requires membership. With `p_block_id`, the caller must be able to edit the character, and `skill_value`/`label` are read from that skill block. NPC rolls are GM-only and get the roller name "GM · <NPC name>". Snapshots name and colour. `p_bonus` is clamped to −20..20. Faces are `floor(random()*3)::int - 1`. A non-GM passing `p_hidden = true` gets `not_gm`; for a GM, `null` means use `gm_roll_mode`. A hidden roll also inserts a `hidden_roll` event (`{ roll_id, roller_name, roller_color }`, no result). |
| `reveal_roll(p_roll_id uuid) returns rolls` | GM only. Sets `is_hidden = false`, `revealed_at = now()`. |
| `set_spotlight(p_session_id uuid, p_character_id uuid default null, p_block_id text default null, p_scene_aspect_id uuid default null) returns jsonb` | GM only. All targets null clears the spotlight. A block target must be a non-empty `aspect` or `consequence` on a character in the session. A scene aspect target must belong to the **active** scene, so players can see it. Anything else raises `invalid_spotlight`. Writes `{ kind, …ids, set_at: now(), by }`. |

**Scenes** (invoker, GM through RLS)

| Function | Behaviour |
|---|---|
| `duplicate_scene(p_scene_id uuid) returns uuid` | Copies a scene with its zones, aspects and tokens (handy for prep). |
| `bring_to_front(p_zone_id uuid) returns int` | Sets `z = max(z)+1` within the scene. It is called when a zone drag starts. |

Plain create, update and delete of scenes, zones, aspects and tokens, and switching the active scene (`update sessions set active_scene_id`), are ordinary table writes under RLS.

Errors are raised with `raise exception using errcode = 'P0001', message = '<code>'`, where `<code>` is one of `not_authenticated`, `not_member`, `not_gm`, `invalid_invite`, `weak_gm_code`, `gm_code_taken`, `rate_limited`, `invalid_spotlight`, `block_not_found`, `invalid_block`, `section_not_empty` or `invalid_scene`. The client maps them to plain-language messages.

---

## 5. Character sheet format

### 5.1 Sections
Stored in `sheet_sections`. In the client and in exports, they are an ordered array:
```json
[ { "id": "s_aspects", "title": "Aspects" }, { "id": "s_skills", "title": "Skills" },
  { "id": "s_stress", "title": "Stress" }, { "id": "s_conseq", "title": "Consequences" },
  { "id": "s_stunts", "title": "Stunts" }, { "id": "s_notes", "title": "Notes" } ]
```
Whether a section is collapsed is a per-device preference in localStorage.

### 5.2 Blocks
The client's logical block (also the export format) is a flat object. Storage maps it to columns as follows:

| Logical field | Column | Notes |
|---|---|---|
| `id` | `id` | `b_` + 10 random base36 chars, generated client-side |
| `type` | `type` | one of the 9 types below |
| `label` | `label` | the block title (may be empty) |
| `value` | `value` (jsonb) | type-specific payload |
| `section` | `section_id` | a section id |
| array order | `position` | fractional; new = midpoint of neighbours |
| every other field (`hint`, `multiline`, `role`, `rollable`, `shift`, `free_invokes`, `max`, `refresh`, `alt`) | `props` (jsonb) | type-specific |

For example, the logical `{ "id":"b_fight00001", "type":"skill", "label":"Fight", "value":3, "section":"s_skills", "rollable":true }` is stored as the row `(id='b_fight00001', type='skill', label='Fight', value='3', section_id='s_skills', props='{"rollable":true}', position=2048)`.

Logical examples, one per type:

**text**: free text; `multiline` controls the editor.
```json
{ "id": "b_k2j9x0aa1q", "type": "text", "label": "Description", "value": "A wiry ex-courier with a prosthetic arm.", "section": "s_notes", "multiline": true }
```
**aspect**: a phrase. `role` ∈ `high_concept | trouble | other` only affects styling and GM card order.
```json
{ "id": "b_7f3mqp0ze2", "type": "aspect", "label": "High Concept", "value": "Disgraced Knight of the Silver Order", "section": "s_aspects", "role": "high_concept" }
```
**skill**: an integer rating (also used for FAE approaches and NPC skills). `rollable` defaults to `true`.
```json
{ "id": "b_fight00001", "type": "skill", "label": "Fight", "value": 3, "section": "s_skills", "rollable": true }
```
**stress**: an array of boxes. `size` is the shifts a box absorbs (Condensed: all 1). `disabled` means locked until unlocked.
```json
{ "id": "b_physstress", "type": "stress", "label": "Physical", "section": "s_stress",
  "value": [ { "size": 1, "checked": false }, { "size": 2, "checked": true }, { "size": 3, "checked": false, "disabled": true } ] }
```
**consequence**: `label` is the severity, `value` the consequence text (empty means free), `shift` the stress it absorbs, and `free_invokes` the invokes the inflicting side holds.
```json
{ "id": "b_mildconseq", "type": "consequence", "label": "Mild", "value": "Bruised Ribs", "section": "s_conseq", "shift": 2, "free_invokes": 1 }
```
**counter**: an integer with optional `max` and `refresh` (the value the Refresh button resets it to).
```json
{ "id": "b_ammo000001", "type": "counter", "label": "Ammo", "value": 4, "section": "s_notes", "max": 6, "refresh": 6 }
```
**number**: an unbounded number.
```json
{ "id": "b_wealth0001", "type": "number", "label": "Silver", "value": 120, "section": "s_notes" }
```
**image**: an `https://` URL only, rendered with `loading="lazy"` and `referrerpolicy="no-referrer"`.
```json
{ "id": "b_portrait01", "type": "image", "label": "Portrait", "value": "https://example.com/knight.png", "section": "s_notes", "alt": "Portrait of the knight" }
```
**separator**: a divider with an optional sub-heading; `value` is always `null`.
```json
{ "id": "b_sep0000001", "type": "separator", "label": "Gear", "value": null, "section": "s_notes" }
```

### 5.3 Fate points and refresh
These are columns on `characters`, not blocks. They have a fixed header strip ("Fate Points 3 · Refresh 3"), the sticky-bar control and the GM's award/take buttons, all through atomic RPCs. NPCs hide them.

### 5.4 Validation
The same rules live in the client (`src/sheet/validate.ts`, unit-tested) and in the `validate_block` trigger:
- `value` types: text/aspect/consequence/image → string; skill/counter/number → number (skill and counter integers); stress → array of 0–20 `{size:int 1..10, checked:bool, disabled?:bool}`; separator → null.
- `props` may only contain the keys listed for that type. Strings are at most 2000 characters, and image URLs must start with `https://`.

### 5.5 Templates
Templates live in client code (`src/sheet/templates.ts`) and generate fresh ids on use. PCs start with fate points 3 and refresh 3.

| Template | Aspects | Skills | Stress | Consequences | Other |
|---|---|---|---|---|---|
| **Fate Core** | High Concept, Trouble, 3 × Aspect | 18 skills (Athletics, Burglary, Contacts, Crafts, Deceive, Drive, Empathy, Fight, Investigate, Lore, Notice, Physique, Provoke, Rapport, Resources, Shoot, Stealth, Will), all 0 | Physical [1,2,(3),(4)], Mental [1,2,(3),(4)]; boxes in brackets disabled | Mild 2, Moderate 4, Severe 6, plus a disabled second Mild | Stunts (text ×3), Extras, Notes |
| **Fate Accelerated** | High Concept, Trouble, 3 × Aspect | 6 approaches (Careful, Clever, Flashy, Forceful, Quick, Sneaky), all 0 | Stress [1,2,3] | Mild 2, Moderate 4, Severe 6 | Stunts (text ×3), Notes |
| **Fate Condensed** | High Concept, Trouble, 3 × Aspect | 19 skills (Core list + Academics), all 0 | Physical [1,1,1,(1),(1),(1)], Mental [1,1,1,(1),(1),(1)] | Mild 2, Moderate 4, Severe 6 | Stunts (text ×3), Notes |
| **Blank** | — | — | — | — | Sections Aspects and Notes, no blocks |
| **NPC** (GM only) | 2 × Aspect, empty, label "Aspect" | 2 × skill with an **empty, fillable label** and value 0 | — | — | Sections "Aspects" and "Skills" only |

### 5.6 Export/import (`.fate.json`)
```json
{ "format": "fate-table-sheet", "version": 1, "kind": "pc", "name": "Sir Aldric", "template": "core",
  "fate_points": 3, "refresh": 3, "sections": [ ... ], "blocks": [ ... ] }
```
`blocks` holds logical blocks in display order. Import validates the file, regenerates duplicate ids, shows a preview and a confirm, then calls `replace_sheet`. NPCs export and import the same way from the NPC tab.

---

## 6. Sheet UI

### 6.1 Play mode (default)
- Single column, one card per section, with tappable headers to collapse. Skill sections with more than 8 blocks are collapsed by default on phones.
- Tapping a value opens a **bottom sheet** with a large input:
  - text, aspect, consequence → textarea; image → URL field.
  - skill, number, counter → big −/+ steppers and a numeric field.
- Stress boxes toggle on tap. Counters show inline −/+.
- Tapping a skill's name or die icon rolls (§7). Long-press, or the pencil icon, edits it.
- Every touch target is at least 44 × 44 px.
- **Read-only** when viewing someone else's sheet: the same layout with no edit affordances, and skills can't be rolled.

### 6.2 Edit mode
- Toggled from the menu (only on sheets you can edit).
- dnd-kit drag handles move blocks within or across sections, and section handles reorder sections. Pointer, touch and keyboard sensors are on, and touch has an activation delay so the page still scrolls.
- Per block: label, type change (only where values convert cleanly, e.g. number ↔ skill ↔ counter, text ↔ aspect), type-specific fields, and delete with an undo toast.
- Per section: rename, delete (`delete_section`), and "Add block" with a type picker.
- Sheet menu: rename, apply template (with a confirm), export JSON, import JSON.

### 6.3 Saving model (per block)
- Every edit is one row-level write: `patch_block`, `set_stress_box`, `adjust_block_value`, `adjust_fate_points`, or a plain insert/delete. Nothing rewrites the whole sheet except import or template.
- Optimistic: the change applies locally right away, and an operation `{ opId, kind, args }` joins the **pending queue**, which is sent in order.
- Text saves on "Done" or when the sheet is dismissed. Steppers are debounced by 400 ms and collapsed into a single delta.
- Realtime rows with `version` ≤ the local version are ignored. Newer rows replace the server copy, and pending operations for that row are re-applied on top so the UI never flickers back.
- Offline failures stay queued (§9.3). Permission or validation errors drop the operation, roll back the row and show an error toast.

---

## 7. Dice

### 7.1 Server-decided rolls
1. The client calls `roll_dice(...)`, which returns the inserted row.
2. Every client in the session receives the INSERT over realtime.
3. Each client animates onto exactly `faces`. The roller starts from the RPC response and de-duplicates the realtime copy by `id`.
4. Rolls arriving more than 10 s after `created_at` (e.g. after a reconnect) go into the log without animating.

Rolling needs a connection; the Roll button and the floating button are disabled offline.

### 7.2 Animation (CSS 3D)
- Four cubes (`transform-style: preserve-3d`), with faces `+`, `+`, blank, blank, `−`, `−` on opposite pairs, drawn in the **roller's colour** (§7.8).
- Final rotation = the target face's base rotation + whole extra turns on X and Y + a small Z jitter. A PRNG seeded from roll `id` + die index picks the turns, so every client shows the same tumble.
- About 1.4 s, `cubic-bezier(.2,.7,.2,1)`, with a 60 ms stagger. `prefers-reduced-motion` shows a fade instead.
- On landing: `navigator.vibrate?.([30,40,30])` (feature-detected; a no-op on iOS), then the result.

### 7.3 Result text and ladder
`"<Roller>: <dice> <Label> <skill> [+ bonus] = <Ladder> (<total>)"`, e.g. **"Bea: +2 Fight +3 = Superb (+5)"**. Numbers are always signed, and the bonus is shown only when it isn't zero. (The brief's example "+2 Fight +3 = Great (+4)" doesn't add up: +2 + 3 = +5 = Superb.)

Ladder (`src/dice/ladder.ts`, unit-tested): −2 Terrible, −1 Poor, 0 Mediocre, +1 Average, +2 Fair, +3 Good, +4 Great, +5 Superb, +6 Fantastic, +7 Epic, +8 Legendary. Below −2 it reads "Terrible (−n)"; above +8 it reads "Legendary +k (n)".

### 7.4 Roll dialog
The sticky bar's **Roll** opens a sheet with: Plain 4dF, a searchable list of rollable skills, and a bonus stepper (−5…+5). For GMs it also lists NPCs' skills and has an Open/Closed switch. Tapping a skill on a sheet or an NPC card rolls it with bonus 0.

### 7.5 Floating 4dF button
- A 56 px circular button on every session screen for every member. **One tap = a plain 4dF roll.**
- Bottom-right with safe-area insets, sitting above the player's sticky bar without covering it. On the zones board it moves to bottom-left so it doesn't cover the zoom controls.
- Long-press (500 ms) opens the roll dialog. While a roll is in flight it shows a spinner and ignores taps.
- It is disabled offline, and hidden while a bottom sheet, the big result view or a drag is active.
- Accessible name "Roll 4dF"; `R` triggers it when focus isn't in an input.
- For GMs it follows the session's open/closed setting and shows an eye-slash badge when closed.

### 7.6 Roll log
A right-hand drawer on desktop, a bottom drawer on phones. It shows the latest 50 rolls and then appends live. Each entry has the roller's name in their colour, mini dice in their colour, the breakdown, the ladder result and a relative time.

### 7.7 Big result view
On phones, after a roll lands, a full-screen overlay tinted with the roller's colour shows the total and ladder name in huge type. It closes on tap or after 4 s, and can be pinned open. It can be turned off for other people's rolls.

### 7.8 Player colours
- Every member, GM included, has one of 12 colours: red, orange, amber, lime, green, teal, cyan, blue, indigo, violet, pink, slate. They are stored as keys and mapped to light/dark shade pairs in `src/ui/colors.ts`, with at least 4.5:1 contrast between face and symbol.
- They are picked on join or create (the first unused colour is pre-selected; taken ones are marked but allowed) and can be changed from the menu.
- Where they show: dice, the log, the big result view, the sheet accent stripe, GM card borders, member lists, and PC tokens on the zones board.
- `rolls.roller_color` is a snapshot, so changing colour doesn't recolour old entries.

### 7.9 Open and closed GM rolls
- `sessions.gm_roll_mode` is `open` (default) or `closed`, set by a GM toolbar toggle. The GM roll dialog has a per-roll override, and the floating button follows the session setting.
- **Closed:** RLS stops players from ever receiving the row, realtime included.
  - GMs see it normally, marked "Hidden".
  - Players get only the `hidden_roll` event. They see four face-down dice in the GM's colour and "GM rolled behind the screen", with no big result.
- **Reveal** (GM log button) → `reveal_roll`. Players receive the row, and their placeholder (matched by `roll_id`) animates onto the real faces, tagged "Revealed". If realtime doesn't deliver a row that has just become visible, the client also refetches on a matching `visibility_changed` event; `reveal_roll` emits one for safety.
- Players' rolls are always open.

---

## 8. GM screen

The GM screen has two tabs: **Players** and **Scenes & NPCs**. The toolbar is shared by both tabs and holds:
- the session name and invite (copy/share)
- the GM fate point pool (− value +)
- GM rolls Open/Closed
- Clear highlight (when one is active)
- the roll log
- the members panel

### 8.1 Players tab
- **Desktop (≥ 1024 px)**: a responsive grid (`repeat(auto-fill,minmax(280px,1fr))`) with one compact card per **PC**, bordered in the owner's colour. Each card shows:
  - the character and player name, and fate points −/+ (award/take)
  - all aspects
  - stress (tap to toggle)
  - filled consequences, with empty blocks collapsed behind an "N empty" chip
  - "Open sheet" (a full sheet with GM edit rights)
- **Phone**: a horizontal scroll-snap pager, one card per PC, with dots and name chips.
- **Award/take**: `adjust_fate_points(±1)`. The player gets a toast. This **never touches the GM pool**; the pool is changed only by its own −/+.
- **Members panel**: invite link, members and roles, kick, assign character, change GM code (new code twice → `change_gm_code`).
- **Active scene strip**: a compact read-only list of the active scene's aspects with free-invoke −/+, so the GM doesn't have to switch tabs mid-fight.

### 8.2 Spotlight: highlighting an aspect or consequence
- **GM**: on Players-tab cards, NPC cards and the active scene (narrative list or zone cards), **tapping an aspect or a filled consequence toggles the spotlight**. On cards, editing moves to the pencil or a long-press. A full sheet has a spotlight icon button instead. There is one highlight at a time; tapping another moves it, and tapping it again clears it. A "Clear highlight" chip shows in the toolbar. Empty aspects and consequences can't be highlighted.
- **Data**: `sessions.spotlight` via `set_spotlight`, delivered through the `sessions` realtime subscription.
  ```json
  { "kind": "block", "character_id": "8c1e…", "block_id": "b_7f3mqp0ze2", "set_at": "2026-11-25T20:14:03Z", "by": "a91f…" }
  { "kind": "scene_aspect", "scene_aspect_id": "3d0a…", "set_at": "2026-11-25T20:15:40Z", "by": "a91f…" }
  ```
  - A spotlight on a hidden NPC's aspect is allowed. Players' pop-ups then show only the aspect text with "An NPC", because they can't read that sheet. `set_spotlight` copies the text into the payload as `text` for that case.
- **Players: a pop-up**, not scrolling:
  - A dimmed backdrop and a centred card ringed in the GM's colour.
  - The header "★ The GM highlights".
  - The text in large type.
  - A subtitle: "Bea's mild consequence", "Your high concept", "Scene aspect · The Bar", or "An NPC", plus free invokes.
  - Behaviour:
    - It closes on tap or OK, or after 8 s. A dismissed highlight (by `set_at`, in localStorage) doesn't pop up again on that device.
    - If the GM moves the highlight, the pop-up switches to the new item. If it's cleared, the pop-up closes.
    - It waits for an open bottom sheet or big result view to close first, and never steals focus.
    - Late joiners see a still-active highlight once.
    - A short vibration plays when the item is your own.
    - Highlights older than 10 minutes are ignored.
- **GM devices**: no pop-up. The highlighted item gets a ring in the GM's colour.

### 8.3 Scenes & NPCs tab
Layout:
- **Desktop**: three columns. On the left, the **scene list**. In the centre, the **scene editor** (narrative list or zones board). On the right, the **NPC roster**, which is collapsible.
- **Phone**: a segmented control (Scene | NPCs), with a scene picker dropdown at the top of Scene.

#### 8.3.1 Scene list
- New scene (name + kind: Narrative or Zones), rename, duplicate (`duplicate_scene`), delete (with a confirm), and drag to reorder.
- **"Show to players"** makes it the active scene (`sessions.active_scene_id`), marked with a ● Live badge. Exactly one scene or none is active; players see only that one. Prep scenes stay private.
- A scene's kind can be switched. Narrative → Zones puts existing aspects in an "Unzoned" tray. Zones → Narrative lists all aspects, grouped under zone titles. Zones and tokens are kept, but hidden while the scene is narrative.

#### 8.3.2 Narrative scenes
- A sortable (dnd-kit) list of scene aspects, each with text and free invokes −/+.
- Add (inline textbox; Enter adds another), edit inline, delete, and drag to reorder.
- Adding an aspect to the active scene toasts every player ("New scene aspect: *On Fire*").

#### 8.3.3 Zones scenes: the board
- **The board**: a fixed logical canvas of **1600 × 1000 board units** with a subtle table-felt background. It is rendered scaled inside a scrollable viewport.
  - Zoom: − / + / Fit buttons (0.4×–2×), Ctrl/⌘+wheel on desktop, and pinch on touch.
  - Pinch and pan are handled with pointer events; no library.
  - All stored coordinates are in board units, so the layout is identical on every screen size.
- **Zones** are index cards: a title bar (which is the drag handle), an optional colour, a list of aspect chips, and "+ Aspect".
  - **Add zone** drops a 300 × 200 card in the centre of the current view.
  - **Move**: drag the title bar. It is free-positioned with no snapping, clamped to the board, and saved on drop. The dragged zone comes to the front (`bring_to_front`).
  - **Resize**: drag the bottom-right corner handle (minimum 160 × 120, saved on release).
  - Rename, recolour, and delete. Deleting keeps the zone's aspects, which move to the Unzoned tray.
- **Aspects in zones**:
  - Add one inside a zone with "+ Aspect".
  - Each chip shows its text and free invokes −/+.
  - A chip can be dragged to another zone or to the **Unzoned tray** (a strip under the board for scene-level aspects). That updates `zone_id`.
  - Within a zone, chips can be reordered by drag.
- **Tokens** (PC and NPC markers):
  - Round markers (40 board units) showing initials, with the full label on hover or long-press.
  - PC tokens use the owner's colour. NPC and free tokens use their own colour (default slate) and get a small square badge so they're distinguishable from PCs.
  - **Add tokens** opens a picker of PCs, NPCs and "Free token…". **Add all PCs** places one token per PC. A character has at most one token per scene; the picker greys out ones already placed.
  - Drag anywhere: free positioning with **no snapping** and no zone-membership logic. A token simply sits on top of whatever zone it's dropped over. Saved on drop.
  - Tokens always render above zones. Tap a token for a menu: rename the label (e.g. "???" for a mystery NPC), recolour, open the sheet, roll (NPC skills), remove.
- **Drag implementation**: dnd-kit `useDraggable` for zones, tokens and aspect chips, and `useDroppable` for zones and the Unzoned tray.
  - On drop, the board-space delta is the screen delta divided by zoom, and the new `x`/`y` (or `zone_id`) is written once.
  - Pointer sensor with a 4 px activation distance; touch sensor with a 150 ms delay, so pinch and pan still work.
  - The keyboard sensor moves the focused item 10 units per arrow press (50 with Shift).
- **Concurrency**: last write wins per row. Other GM devices and players see the item jump to its new place on drop.

#### 8.3.4 What players see of scenes
- The player screen has a **Scene** tab (§9.1) showing the active scene read-only:
  - **Narrative**: the aspect list with free invokes.
  - **Zones**: the same board at Fit zoom, with pinch/zoom and pan, but nothing draggable.
- No active scene → the empty state "The GM hasn't shared a scene yet."
- When the GM switches the active scene, players' Scene tab swaps to it live, refetched on the `sessions` update and the `visibility_changed` event.

#### 8.3.5 NPC roster
- NPCs are `characters` with `kind = 'npc'`, owned by the GM role (`owner_id` null), using the **NPC template**: name, aspects, and one or two blank, fillable skills.
- **NPC card** (compact, edited in place):
  - The name field.
  - Aspects: tap to edit, tap to spotlight via the star icon. **+ Aspect** adds another.
  - Skills: the label and value are both editable in place, e.g. type "Fight" and set +2. Tap the die to roll. **+ Skill** adds another.
  - Every card is expandable this way with no edit mode. "Open full sheet" gives the normal sheet editor, so the GM can add stress, consequences or any other block type when an NPC needs it.
- **Roster actions**:
  - Card actions: New NPC, duplicate (quick minions: "Thug", "Thug 2"…), delete, and drag to reorder.
  - Search by name.
  - **Show to players** toggle (`visible_to_players`, default off) with an eye icon.
  - **Add to scene** places a token on the open zones scene.
- Visible NPCs appear read-only in players' **Table** tab (§9.1). Hidden NPCs are invisible to players at the database level (§4.3). Their tokens still show the token's own label, which the GM controls.
- NPC rolls: skill rolls follow the open/closed setting and log as "GM · Thug: +1 Fight +2 = Good (+3)", in the GM's colour.

---

## 9. Mobile and PWA

### 9.1 Player layout
- Designed and tested at 375 × 667 first. Single column, `max-w-screen-sm` centred on larger screens.
- **Top tabs**: **My sheet** | **Table** | **Scene**.
  - Table lists the other PCs and any visible NPCs. Tap one to view their sheet read-only.
  - Scene is §8.3.4.
- **Sticky bottom bar** (safe-area padded): fate points (− value +), **Roll**, and the ☰ menu (edit mode, roll log, colour, wake lock, shake-to-roll, theme, export/import, leave). The floating 4dF button sits above it.
- Bottom sheets: a portal and backdrop, drag-down to dismiss, focus trap, and the input kept above the keyboard with `visualViewport`.

### 9.2 PWA
- `vite-plugin-pwa`, `registerType: 'prompt'`, with an "Update available — reload" toast.
- A manifest (standalone; 192/512 and maskable icons) and a precached app shell, with SPA fallback to `index.html`.
- Supabase calls are never cached by the service worker; the app handles offline data itself (§9.3).

### 9.3 Offline
- **Cache**: the session bundle goes to `fate.cache.<sessionId>` in localStorage on every change: session, members, characters, sections, blocks, the active scene with its zones, aspects and tokens, and the last 50 rolls. When offline or slow, the app renders from cache.
- **Queue**: pending operations are saved to `fate.queue.<sessionId>`, so they survive reloads.
- **Reconnect**: on `online`, a realtime re-subscribe, or the tab becoming visible, the app (1) flushes the queue in order, (2) refetches the bundle, then (3) resumes realtime. Rejected operations are dropped with a toast.
- The offline banner shows "Offline — N changes waiting".
- Conflicts: last write wins per field (`patch_block`) or per stress box. Deltas (`adjust_*`) commute.
- Sheet edits are queued offline. GM scene and board edits are queued the same way. Rolls are not (they need the server).

### 9.4 Device features (feature-detected and opt-in)
- **Wake Lock**: a toggle that calls `navigator.wakeLock.request('screen')` and re-acquires on `visibilitychange`.
- **Shake to roll**:
  - "Enable shake to roll" calls `DeviceMotionEvent.requestPermission()` on iOS.
  - A roll fires when acceleration (including gravity, minus gravity) exceeds about 18 m/s² twice within 400 ms. It rolls the last-used skill, or a plain roll.
  - 2 s cooldown; paused while a sheet is open.
- **Haptics**: `navigator.vibrate` on dice landing, fate point changes, and a spotlight on your item.
- **Toasts**: scene aspect added (active scene), fate point awarded or taken, member joined (GM), errors, update available.
- **HTTPS**: wake lock, device motion and service workers need a secure context. `npm run dev -- --host` over plain `http://192.168.x.x` is for layout and touch testing. Those features are tested on a **Vercel preview deploy**, which builds automatically on push.

---

## 10. Realtime

- There is one channel per session, `session:<id>`. It has `postgres_changes` INSERT/UPDATE listeners filtered by `session_id=eq.<id>` for:
  - `session_members`, `characters`, `sheet_sections`, `sheet_blocks`
  - `rolls`, `scenes`, `scene_zones`, `scene_aspects`, `scene_tokens`
  - `session_events`

  It also has `id=eq.<id>` for `sessions`. RLS is applied per subscriber, so players never receive hidden NPCs, inactive scenes or closed rolls.
- **DELETE events**: Supabase can't filter DELETE events or apply RLS to them, and sends only the primary key. The client listens to DELETEs unfiltered and ignores keys it doesn't hold. Keys are opaque uuids or block ids, so no content leaks.
- **Visibility changes**: when something becomes hidden from players (an NPC hidden, the active scene changed), players can't receive that update. The `visibility_changed` event tells clients to drop the item and refetch.
- A `SessionProvider` reducer applies events, replacing by key, gated by `version`. Pending local operations are re-applied on top.
- When the channel reaches `SUBSCRIBED` again after a disconnect, the app runs the reconnect sequence (§9.3).

---

## 11. App structure and routes

| Route | Screen |
|---|---|
| `/` | Home: resume, join with code, GM code textbox (reclaim or create) |
| `/join/:code` | Join (display name + colour) |
| `/s/:sessionId` | Redirects by role: GM → `/gm`; player → own sheet, or character creation |
| `/s/:sessionId/new-character` | Template picker + name |
| `/s/:sessionId/c/:characterId` | Character sheet (editable, or read-only if not yours) |
| `/s/:sessionId/table`, `/s/:sessionId/scene` | Player tabs |
| `/s/:sessionId/gm` and `/s/:sessionId/gm/scenes` | GM tabs: Players, Scenes & NPCs |
| `*` | Not found |

```
src/
  main.tsx, App.tsx, routes.tsx
  lib/            supabase.ts, errors.ts, storage.ts, positions.ts (fractional ordering)
  session/        SessionProvider, realtime.ts, cache.ts, queue.ts
  sheet/          types.ts, templates.ts, validate.ts, ops.ts, components/
  dice/           ladder.ts, prng.ts, Dice3D.tsx, RollDialog.tsx, RollFab.tsx, RollLog.tsx, BigResult.tsx
  gm/             GmLayout.tsx, PlayersTab.tsx, CharacterCard.tsx, MembersPanel.tsx, Spotlight.tsx
  scenes/         SceneList.tsx, NarrativeScene.tsx, ZonesBoard.tsx, Zone.tsx, Token.tsx, boardMath.ts
  npcs/           NpcRoster.tsx, NpcCard.tsx
  ui/             BottomSheet, Toast, Stepper, Drawer, Tabs, colors.ts, icons
  device/         wakeLock.ts, shake.ts, haptics.ts
supabase/migrations/  0001_schema.sql, 0002_rls.sql, 0003_rpcs.sql, 0004_realtime.sql
scripts/rls-test.mjs
```

---

## 12. Theming, accessibility and errors
- Theme: light / dark / system (default system), stored in localStorage. Colours are CSS variables used by Tailwind.
- Text contrast is at least 4.5:1, focus rings are visible, rolls and spotlights are announced in an `aria-live` region, and the board is keyboard-operable (§8.3.3).
- Empty states: no PCs yet (GM sees the invite), empty section, no rolls, no scenes, no active scene, no NPCs.
- RPC errors are shown in plain language. A top-level error boundary offers "Reload". Network failures are queued or retried, never shown raw.

---

## 13. Testing
- At the end of every slice: `npm run typecheck`, `npm test` (vitest) and `npm run build` must pass.
- **Unit tests (vitest)**:
  - ladder text
  - PRNG determinism and dice rotation targets
  - GM code normalisation and strength rules
  - fractional positions
  - block validation, templates, export/import round-trip
  - board math (screen ↔ board coordinates, clamping)
  - the queue's re-apply logic
- **RLS test** (`npm run test:rls` → `scripts/rls-test.mjs`): uses `@supabase/supabase-js` against your project with the anon key. It signs in anonymous users — GM A, players A1 and A2, and player B in another session — and asserts:
  - **Sessions and isolation**
    - B can't select anything from session A (sessions, members, characters, blocks, rolls, scenes, zones, aspects, tokens, events).
    - The GM can't read session B.
    - `claim_gm` returns `null` for an unknown code; the 11th failure in 10 minutes raises `rate_limited`.
    - `create_session` rejects an already-used code (`gm_code_taken`) and a weak one (`weak_gm_code`).
  - **Sheets**
    - A2 can **read** A1's sheet but can't update or delete A1's character, sections or blocks, or call `patch_block`/`set_stress_box` on them.
    - The GM can edit A1's blocks and adjust fate points.
  - **Locked-down tables**
    - Players can't insert `rolls` directly, read `session_secrets`, or update `sessions` (including `spotlight` and `active_scene_id`).
    - A player can change their own `color`, not another member's.
  - **NPCs and scenes**
    - Players can't see a hidden NPC or its blocks; after `visible_to_players = true` they can read it, but still can't edit it.
    - Players can't create NPCs.
    - Players see only the active scene and its zones, aspects and tokens, never a prep scene.
    - Players can't create, move or delete scenes, zones, aspects or tokens.
  - **Rolls and spotlight**
    - A closed GM roll is invisible to A1 (who sees only the `hidden_roll` event) until `reveal_roll`.
    - A player using `p_hidden => true` gets `not_gm`.
    - Players can't call `reveal_roll` or `set_spotlight`.
    - `set_spotlight` on another session's aspect raises `invalid_spotlight`.

  It prints PASS/FAIL per check and exits non-zero on any failure. Anonymous sign-ins must be enabled.
- Manual test scripts for each slice are in PLAN.md.

---

## 14. Decisions (from your answers)
1. **Storage**: one row per section and per block (`sheet_sections`, `sheet_blocks`), with type-specific fields in jsonb. Chosen as the more modular option.
2. **Visibility**: players can read every PC sheet (read-only) and edit only their own. NPCs and prep scenes are GM-only unless shared.
3. **HTTPS on phones**: plain `--host` for layout; a Vercel preview for wake lock, shake and PWA install. No extra dependency.
4. **Dev dependencies**: `vitest` and the `supabase` CLI are added.
5. **GM fate pool**: fully manual; awards and takes never change it.
6. **NPCs and scenes**: a separate GM tab, "Scenes & NPCs", with narrative and zones scenes and an NPC roster (§8.3).
