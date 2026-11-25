-- Fate Table: tables, internal helpers and triggers.
-- See SPEC.md §4. RLS lives in 0002, RPCs in 0003, realtime + vault in 0004.

create extension if not exists pgcrypto with schema extensions;

-- Internal schema: not exposed through the Data API (PostgREST only serves `public`).
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Shared constants
-- ---------------------------------------------------------------------------

create or replace function private.palette()
returns text[] language sql immutable set search_path = '' as $$
  select array['red','orange','amber','lime','green','teal','cyan','blue','indigo','violet','pink','slate']
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.sessions (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (char_length(name) between 1 and 80),
  invite_code     text not null unique check (invite_code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  gm_fate_points  int  not null default 0 check (gm_fate_points >= 0),
  gm_roll_mode    text not null default 'open' check (gm_roll_mode in ('open','closed')),
  active_scene_id uuid,
  spotlight       jsonb,
  created_by      uuid references auth.users(id) on delete set null,
  version         bigint not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.session_secrets (
  session_id   uuid primary key references public.sessions(id) on delete cascade,
  gm_code_hash text not null unique
);

create table public.gm_code_attempts (
  user_id      uuid not null references auth.users(id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index gm_code_attempts_user_idx on public.gm_code_attempts (user_id, attempted_at desc);

create table public.session_members (
  session_id   uuid not null references public.sessions(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null check (role in ('gm','player')),
  display_name text not null check (char_length(display_name) between 1 and 40),
  color        text not null default 'slate' check (color = any (private.palette())),
  joined_at    timestamptz not null default now(),
  primary key (session_id, user_id)
);
create index session_members_user_idx on public.session_members (user_id);

create table public.characters (
  id                 uuid primary key default gen_random_uuid(),
  session_id         uuid not null references public.sessions(id) on delete cascade,
  kind               text not null default 'pc' check (kind in ('pc','npc')),
  owner_id           uuid references auth.users(id) on delete set null,
  name               text not null default 'Unnamed' check (char_length(name) <= 80),
  template           text not null check (template in ('core','accelerated','condensed','blank','npc')),
  fate_points        int  not null default 3 check (fate_points >= 0),
  refresh            int  not null default 3 check (refresh >= 0),
  visible_to_players boolean not null default false,
  position           double precision not null default 0,
  version            bigint not null default 1,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (kind = 'pc' or owner_id is null)
);
create index characters_session_idx on public.characters (session_id);

create table public.sheet_sections (
  character_id uuid not null references public.characters(id) on delete cascade,
  id           text not null check (id ~ '^s_[a-z0-9_]{3,32}$'),
  session_id   uuid not null references public.sessions(id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 60),
  position     double precision not null,
  version      bigint not null default 1,
  updated_at   timestamptz not null default now(),
  primary key (character_id, id)
);
create index sheet_sections_session_idx on public.sheet_sections (session_id);

create table public.sheet_blocks (
  character_id uuid not null references public.characters(id) on delete cascade,
  id           text not null check (id ~ '^b_[a-z0-9]{6,32}$'),
  session_id   uuid not null references public.sessions(id) on delete cascade,
  section_id   text not null,
  type         text not null check (type in
                 ('text','aspect','skill','stress','consequence','counter','number','image','separator')),
  label        text not null default '' check (char_length(label) <= 200),
  value        jsonb,
  props        jsonb not null default '{}'::jsonb,
  position     double precision not null,
  version      bigint not null default 1,
  updated_at   timestamptz not null default now(),
  primary key (character_id, id),
  foreign key (character_id, section_id)
    references public.sheet_sections(character_id, id) on update cascade
);
create index sheet_blocks_session_idx on public.sheet_blocks (session_id);
create index sheet_blocks_order_idx on public.sheet_blocks (character_id, section_id, position);

create table public.rolls (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.sessions(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete set null,
  character_id uuid references public.characters(id) on delete set null,
  roller_name  text not null,
  roller_color text not null,
  is_hidden    boolean not null default false,
  revealed_at  timestamptz,
  label        text,
  skill_value  int  not null default 0,
  bonus        int  not null default 0,
  faces        smallint[] not null
                 check (array_length(faces, 1) = 4 and faces <@ array[-1,0,1]::smallint[]),
  dice_total   int  not null,
  total        int  not null,
  created_at   timestamptz not null default now()
);
create index rolls_session_idx on public.rolls (session_id, created_at desc);

create table public.scenes (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 80),
  kind       text not null default 'narrative' check (kind in ('narrative','zones')),
  position   double precision not null default 0,
  version    bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index scenes_session_idx on public.scenes (session_id, position);

alter table public.sessions
  add constraint sessions_active_scene_fk
  foreign key (active_scene_id) references public.scenes(id) on delete set null;

create table public.scene_zones (
  id         uuid primary key default gen_random_uuid(),
  scene_id   uuid not null references public.scenes(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  title      text not null default 'Zone' check (char_length(title) <= 60),
  color      text check (color is null or color = any (private.palette())),
  x          real not null check (x between 0 and 1600),
  y          real not null check (y between 0 and 1000),
  w          real not null default 300 check (w between 160 and 1600),
  h          real not null default 200 check (h between 120 and 1000),
  z          int  not null default 0,
  version    bigint not null default 1,
  updated_at timestamptz not null default now()
);
create index scene_zones_scene_idx on public.scene_zones (scene_id);
create index scene_zones_session_idx on public.scene_zones (session_id);

create table public.scene_aspects (
  id           uuid primary key default gen_random_uuid(),
  scene_id     uuid not null references public.scenes(id) on delete cascade,
  session_id   uuid not null references public.sessions(id) on delete cascade,
  zone_id      uuid references public.scene_zones(id) on delete set null,
  text         text not null check (char_length(text) between 1 and 200),
  free_invokes int  not null default 0 check (free_invokes between 0 and 99),
  position     double precision not null default 0,
  version      bigint not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index scene_aspects_scene_idx on public.scene_aspects (scene_id, zone_id, position);
create index scene_aspects_session_idx on public.scene_aspects (session_id);

create table public.scene_tokens (
  id           uuid primary key default gen_random_uuid(),
  scene_id     uuid not null references public.scenes(id) on delete cascade,
  session_id   uuid not null references public.sessions(id) on delete cascade,
  character_id uuid references public.characters(id) on delete set null,
  label        text not null check (char_length(label) between 1 and 40),
  color        text check (color is null or color = any (private.palette())),
  x            real not null check (x between 0 and 1600),
  y            real not null check (y between 0 and 1000),
  version      bigint not null default 1,
  updated_at   timestamptz not null default now()
);
create index scene_tokens_scene_idx on public.scene_tokens (scene_id);
create index scene_tokens_session_idx on public.scene_tokens (session_id);
create unique index scene_tokens_one_per_character
  on public.scene_tokens (scene_id, character_id) where character_id is not null;

create table public.session_events (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null references public.sessions(id) on delete cascade,
  kind                text not null check (kind in ('scene_aspect_added','fate_point_awarded','fate_point_taken',
                        'member_joined','hidden_roll','visibility_changed')),
  target_character_id uuid references public.characters(id) on delete cascade,
  payload             jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);
create index session_events_session_idx on public.session_events (session_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Error helper and event emitter
-- ---------------------------------------------------------------------------

-- Raise one of the stable error codes listed in SPEC §4.4.
create or replace function private.fail(p_code text)
returns void language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = 'P0001', message = p_code;
end $$;

-- Insert a session event. Definer: clients have no insert rights on session_events.
create or replace function private.emit_event(
  p_session_id uuid, p_kind text, p_target_character_id uuid default null, p_payload jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.session_events (session_id, kind, target_character_id, payload)
  values (p_session_id, p_kind, p_target_character_id, coalesce(p_payload, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- Generic triggers
-- ---------------------------------------------------------------------------

create or replace function private.touch_row()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end $$;

create trigger touch before update on public.sessions       for each row execute function private.touch_row();
create trigger touch before update on public.characters     for each row execute function private.touch_row();
create trigger touch before update on public.sheet_sections for each row execute function private.touch_row();
create trigger touch before update on public.sheet_blocks   for each row execute function private.touch_row();
create trigger touch before update on public.scenes         for each row execute function private.touch_row();
create trigger touch before update on public.scene_zones    for each row execute function private.touch_row();
create trigger touch before update on public.scene_aspects  for each row execute function private.touch_row();
create trigger touch before update on public.scene_tokens   for each row execute function private.touch_row();

-- Children of a character get session_id from it; the parent link can't change.
create or replace function private.session_from_character()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    select c.session_id into new.session_id from public.characters c where c.id = new.character_id;
  elsif new.character_id <> old.character_id or new.session_id <> old.session_id then
    perform private.fail('invalid_input');
  end if;
  return new;
end $$;

create trigger session_id before insert or update on public.sheet_sections
  for each row execute function private.session_from_character();
create trigger session_id before insert or update on public.sheet_blocks
  for each row execute function private.session_from_character();

-- Children of a scene get session_id from it; the parent link can't change.
create or replace function private.session_from_scene()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    select s.session_id into new.session_id from public.scenes s where s.id = new.scene_id;
  elsif new.scene_id <> old.scene_id or new.session_id <> old.session_id then
    perform private.fail('invalid_input');
  end if;
  return new;
end $$;

create trigger session_id before insert or update on public.scene_zones
  for each row execute function private.session_from_scene();
create trigger session_id before insert or update on public.scene_aspects
  for each row execute function private.session_from_scene();
create trigger session_id before insert or update on public.scene_tokens
  for each row execute function private.session_from_scene();

-- ---------------------------------------------------------------------------
-- Membership helpers (used by triggers here and by RLS in 0002)
-- ---------------------------------------------------------------------------

create or replace function private.is_session_member(p_session_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.session_members m
    where m.session_id = p_session_id and m.user_id = (select auth.uid())
  )
$$;

create or replace function private.is_session_gm(p_session_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.session_members m
    where m.session_id = p_session_id and m.user_id = (select auth.uid()) and m.role = 'gm'
  )
$$;

-- ---------------------------------------------------------------------------
-- Table-specific triggers
-- ---------------------------------------------------------------------------

create or replace function private.characters_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.session_id <> old.session_id or new.kind <> old.kind then
    perform private.fail('invalid_input');
  end if;
  if new.owner_id is distinct from old.owner_id and not private.is_session_gm(old.session_id) then
    perform private.fail('not_gm');
  end if;
  if new.kind = 'pc' and new.visible_to_players then
    new.visible_to_players := false;  -- PCs are always visible; the flag only means something for NPCs
  end if;
  return new;
end $$;

create trigger guard before update on public.characters
  for each row execute function private.characters_guard();

-- Validate a block's value and props for its type (SPEC §5.4).
create or replace function private.validate_block()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_allowed text[];
  v_key text;
  v_box jsonb;
  v_num numeric;
begin
  -- value
  case new.type
    when 'text', 'aspect', 'consequence', 'image' then
      if new.value is null or jsonb_typeof(new.value) <> 'string' then perform private.fail('invalid_block'); end if;
      if char_length(new.value #>> '{}') > 2000 then perform private.fail('invalid_block'); end if;
      if new.type = 'image' and (new.value #>> '{}') <> '' and (new.value #>> '{}') !~ '^https://' then
        perform private.fail('invalid_block');
      end if;
    when 'skill', 'counter', 'number' then
      if new.value is null or jsonb_typeof(new.value) <> 'number' then perform private.fail('invalid_block'); end if;
      v_num := (new.value #>> '{}')::numeric;
      if new.type in ('skill', 'counter') and v_num <> trunc(v_num) then perform private.fail('invalid_block'); end if;
      if abs(v_num) > 1000000000 then perform private.fail('invalid_block'); end if;
    when 'stress' then
      if new.value is null or jsonb_typeof(new.value) <> 'array' or jsonb_array_length(new.value) > 20 then
        perform private.fail('invalid_block');
      end if;
      for v_box in select e from jsonb_array_elements(new.value) e loop
        if jsonb_typeof(v_box) <> 'object'
           or jsonb_typeof(v_box -> 'size') is distinct from 'number'
           or jsonb_typeof(v_box -> 'checked') is distinct from 'boolean'
           or (v_box ? 'disabled' and jsonb_typeof(v_box -> 'disabled') <> 'boolean')
           or exists (select 1 from jsonb_object_keys(v_box) k where k not in ('size','checked','disabled')) then
          perform private.fail('invalid_block');
        end if;
        v_num := (v_box ->> 'size')::numeric;
        if v_num <> trunc(v_num) or v_num < 1 or v_num > 10 then perform private.fail('invalid_block'); end if;
      end loop;
    when 'separator' then
      if new.value is not null and jsonb_typeof(new.value) <> 'null' then perform private.fail('invalid_block'); end if;
      new.value := null;
  end case;

  -- props
  if jsonb_typeof(new.props) <> 'object' then perform private.fail('invalid_block'); end if;
  v_allowed := array['hint'] || case new.type
    when 'text'        then array['multiline']
    when 'aspect'      then array['role']
    when 'skill'       then array['rollable']
    when 'consequence' then array['shift','free_invokes']
    when 'counter'     then array['max','refresh']
    when 'image'       then array['alt']
    else array[]::text[]
  end;
  for v_key in select jsonb_object_keys(new.props) loop
    if not v_key = any (v_allowed) then perform private.fail('invalid_block'); end if;
  end loop;

  if new.props ? 'hint' and (jsonb_typeof(new.props->'hint') <> 'string' or char_length(new.props->>'hint') > 200) then
    perform private.fail('invalid_block');
  end if;
  if new.props ? 'alt' and (jsonb_typeof(new.props->'alt') <> 'string' or char_length(new.props->>'alt') > 200) then
    perform private.fail('invalid_block');
  end if;
  if new.props ? 'multiline' and jsonb_typeof(new.props->'multiline') <> 'boolean' then perform private.fail('invalid_block'); end if;
  if new.props ? 'rollable' and jsonb_typeof(new.props->'rollable') <> 'boolean' then perform private.fail('invalid_block'); end if;
  if new.props ? 'role' and (new.props->>'role') is distinct from 'high_concept'
     and (new.props->>'role') is distinct from 'trouble' and (new.props->>'role') is distinct from 'other' then
    perform private.fail('invalid_block');
  end if;
  foreach v_key in array array['shift','free_invokes','max','refresh'] loop
    if new.props ? v_key then
      if jsonb_typeof(new.props->v_key) <> 'number' then perform private.fail('invalid_block'); end if;
      v_num := (new.props->>v_key)::numeric;
      if v_num <> trunc(v_num) or v_num < 0 or v_num > 999 then perform private.fail('invalid_block'); end if;
    end if;
  end loop;

  return new;
end $$;

create trigger validate before insert or update on public.sheet_blocks
  for each row execute function private.validate_block();

-- At most 300 blocks and 30 sections per character.
create or replace function private.sheet_limits()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'sheet_blocks' then
    if (select count(*) from public.sheet_blocks b where b.character_id = new.character_id) >= 300 then
      perform private.fail('sheet_limit');
    end if;
  else
    if (select count(*) from public.sheet_sections s where s.character_id = new.character_id) >= 30 then
      perform private.fail('sheet_limit');
    end if;
  end if;
  return new;
end $$;

create trigger limits before insert on public.sheet_blocks
  for each row execute function private.sheet_limits();
create trigger limits before insert on public.sheet_sections
  for each row execute function private.sheet_limits();

-- Cross-row references must stay inside the same session/scene.
create or replace function private.sessions_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.active_scene_id is distinct from old.active_scene_id and new.active_scene_id is not null
     and not exists (select 1 from public.scenes s where s.id = new.active_scene_id and s.session_id = new.id) then
    perform private.fail('invalid_scene');
  end if;
  if new.invite_code <> old.invite_code or new.created_by is distinct from old.created_by then
    perform private.fail('invalid_input');
  end if;
  return new;
end $$;

create trigger guard before update on public.sessions
  for each row execute function private.sessions_guard();

create or replace function private.scene_aspects_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.zone_id is not null
     and not exists (select 1 from public.scene_zones z where z.id = new.zone_id and z.scene_id = new.scene_id) then
    perform private.fail('invalid_scene');
  end if;
  return new;
end $$;

-- Runs after session_from_scene (trigger names fire alphabetically: "session_id" < "zone_guard").
create trigger zone_guard before insert or update on public.scene_aspects
  for each row execute function private.scene_aspects_guard();

create or replace function private.scene_tokens_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.character_id is not null
     and not exists (select 1 from public.characters c where c.id = new.character_id and c.session_id = new.session_id) then
    perform private.fail('invalid_scene');
  end if;
  return new;
end $$;

create trigger zone_guard before insert or update on public.scene_tokens
  for each row execute function private.scene_tokens_guard();

-- Events -------------------------------------------------------------------

create or replace function private.scene_aspect_added_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.sessions s where s.id = new.session_id and s.active_scene_id = new.scene_id) then
    perform private.emit_event(new.session_id, 'scene_aspect_added', null,
      jsonb_build_object('scene_aspect_id', new.id, 'text', new.text));
  end if;
  return null;
end $$;

create trigger added_event after insert on public.scene_aspects
  for each row execute function private.scene_aspect_added_event();

create or replace function private.member_joined_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.role = 'player' then
    perform private.emit_event(new.session_id, 'member_joined', null,
      jsonb_build_object('user_id', new.user_id, 'display_name', new.display_name));
  end if;
  return null;
end $$;

create trigger joined_event after insert on public.session_members
  for each row execute function private.member_joined_event();

create or replace function private.character_visibility_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.visible_to_players is distinct from old.visible_to_players then
    perform private.emit_event(new.session_id, 'visibility_changed', null,
      jsonb_build_object('table', 'characters', 'id', new.id, 'visible', new.visible_to_players));
  end if;
  return null;
end $$;

create trigger visibility_event after update on public.characters
  for each row execute function private.character_visibility_event();

create or replace function private.active_scene_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.active_scene_id is distinct from old.active_scene_id then
    perform private.emit_event(new.id, 'visibility_changed', null,
      jsonb_build_object('table', 'scenes', 'old_id', old.active_scene_id, 'id', new.active_scene_id));
  end if;
  return null;
end $$;

create trigger visibility_event after update on public.sessions
  for each row execute function private.active_scene_event();
