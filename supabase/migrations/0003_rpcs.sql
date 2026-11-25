-- Fate Table: RPCs (SPEC §4.4).
-- Definer functions check authorization themselves; invoker functions rely on RLS.

-- ---------------------------------------------------------------------------
-- GM code helpers (internal)
-- ---------------------------------------------------------------------------

-- Lower-case, treat runs of whitespace / - _ . as one space, trim.
-- Mirrors src/lib/gmCode.ts normalizeGmCode().
create or replace function private.normalize_gm_code(p_code text)
returns text language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(lower(coalesce(p_code, '')), '[\s._-]+', ' ', 'g'))
$$;

-- Mirrors src/lib/gmCode.ts gmCodeProblem().
create or replace function private.gm_code_is_strong(p_normalized text)
returns boolean language sql immutable set search_path = '' as $$
  select char_length(p_normalized) >= 10
     and replace(p_normalized, ' ', '') !~ '^(.)\1*$'
     and replace(p_normalized, ' ', '') <> all (array[
           'password','password1','password12','password123','password1234',
           '1234567890','12345678910','0123456789','9876543210','qwertyuiop','asdfghjkl',
           'abcdefghij','abcdefghijk','letmeinplease','iamthegm','gamemaster','gamemaster1',
           'fatecore','fatecorerpg','fateaccelerated','fatecondensed','dungeonmaster'])
$$;

create or replace function private.gm_pepper()
returns text language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  select ds.decrypted_secret into v from vault.decrypted_secrets ds where ds.name = 'gm_code_pepper' limit 1;
  if v is null then perform private.fail('server_misconfigured'); end if;
  return v;
end $$;

create or replace function private.gm_code_hash(p_normalized text)
returns text language sql stable security definer set search_path = '' as $$
  select encode(extensions.hmac(p_normalized, private.gm_pepper(), 'sha256'), 'hex')
$$;

-- Random code from a 32-character alphabet (no 0/O/1/I). 256 % 32 = 0, so no modulo bias.
create or replace function private.random_code(p_len int)
returns text language sql volatile set search_path = '' as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(b.bytes, i) % 32) + 1, 1), '' order by i)
  from (select extensions.gen_random_bytes(p_len) as bytes) b, generate_series(0, p_len - 1) as i
$$;

create or replace function private.require_uid()
returns uuid language plpgsql stable set search_path = '' as $$
declare v uuid := auth.uid();
begin
  if v is null then perform private.fail('not_authenticated'); end if;
  return v;
end $$;

create or replace function private.clean_display_name(p_name text)
returns text language plpgsql immutable set search_path = '' as $$
declare v text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if char_length(v) < 1 or char_length(v) > 40 then perform private.fail('invalid_input'); end if;
  return v;
end $$;

create or replace function private.check_color(p_color text)
returns text language plpgsql immutable set search_path = '' as $$
begin
  if p_color is not null and not (p_color = any (private.palette())) then perform private.fail('invalid_input'); end if;
  return p_color;
end $$;

-- ---------------------------------------------------------------------------
-- Sessions and members
-- ---------------------------------------------------------------------------

create or replace function public.create_session(
  p_gm_code text, p_name text, p_display_name text, p_color text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := private.require_uid();
  v_norm  text := private.normalize_gm_code(p_gm_code);
  v_hash  text;
  v_name  text := btrim(coalesce(p_name, ''));
  v_dn    text := private.clean_display_name(p_display_name);
  v_color text := coalesce(private.check_color(p_color), 'slate');
  v_inv   text;
  v_sid   uuid;
  v_scene uuid;
begin
  if not private.gm_code_is_strong(v_norm) then perform private.fail('weak_gm_code'); end if;
  if char_length(v_name) < 1 or char_length(v_name) > 80 then perform private.fail('invalid_input'); end if;

  v_hash := private.gm_code_hash(v_norm);
  if exists (select 1 from public.session_secrets s where s.gm_code_hash = v_hash) then
    perform private.fail('gm_code_taken');
  end if;

  loop
    v_inv := private.random_code(6);
    exit when not exists (select 1 from public.sessions s where s.invite_code = v_inv);
  end loop;

  insert into public.sessions (name, invite_code, created_by)
  values (v_name, v_inv, v_uid) returning id into v_sid;

  begin
    insert into public.session_secrets (session_id, gm_code_hash) values (v_sid, v_hash);
  exception when unique_violation then
    perform private.fail('gm_code_taken');
  end;

  insert into public.session_members (session_id, user_id, role, display_name, color)
  values (v_sid, v_uid, 'gm', v_dn, v_color);

  insert into public.scenes (session_id, name, kind) values (v_sid, 'Scene 1', 'narrative')
  returning id into v_scene;
  update public.sessions set active_scene_id = v_scene where id = v_sid;

  return jsonb_build_object('session_id', v_sid, 'invite_code', v_inv);
end $$;

create or replace function public.claim_gm(p_gm_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_uid();
  v_norm text := private.normalize_gm_code(p_gm_code);
  v_sid  uuid;
begin
  if (select count(*) from public.gm_code_attempts a
      where a.user_id = v_uid and a.attempted_at > now() - interval '10 minutes') >= 10 then
    perform private.fail('rate_limited');
  end if;

  if private.gm_code_is_strong(v_norm) then
    select s.session_id into v_sid from public.session_secrets s where s.gm_code_hash = private.gm_code_hash(v_norm);
  end if;

  if v_sid is null then
    insert into public.gm_code_attempts (user_id) values (v_uid);
    return null;
  end if;

  insert into public.session_members (session_id, user_id, role, display_name, color)
  values (v_sid, v_uid, 'gm', 'GM', 'slate')
  on conflict (session_id, user_id) do update set role = 'gm';

  return v_sid;
end $$;

create or replace function public.change_gm_code(p_session_id uuid, p_new_code text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_norm text := private.normalize_gm_code(p_new_code);
  v_hash text;
begin
  perform private.require_uid();
  if not private.is_session_gm(p_session_id) then perform private.fail('not_gm'); end if;
  if not private.gm_code_is_strong(v_norm) then perform private.fail('weak_gm_code'); end if;
  v_hash := private.gm_code_hash(v_norm);
  if exists (select 1 from public.session_secrets s where s.gm_code_hash = v_hash and s.session_id <> p_session_id) then
    perform private.fail('gm_code_taken');
  end if;
  update public.session_secrets set gm_code_hash = v_hash where session_id = p_session_id;
end $$;

create or replace function public.join_session(p_invite_code text, p_display_name text, p_color text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := private.require_uid();
  v_code  text := upper(regexp_replace(coalesce(p_invite_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_dn    text := private.clean_display_name(p_display_name);
  v_color text := private.check_color(p_color);
  v_sid   uuid;
begin
  select s.id into v_sid from public.sessions s where s.invite_code = v_code;
  if v_sid is null then perform private.fail('invalid_invite'); end if;

  if v_color is null then
    select c into v_color
    from unnest(private.palette()) with ordinality as p(c, ord)
    where not exists (select 1 from public.session_members m where m.session_id = v_sid and m.color = p.c)
    order by ord limit 1;
    v_color := coalesce(v_color, 'slate');
  end if;

  insert into public.session_members (session_id, user_id, role, display_name, color)
  values (v_sid, v_uid, 'player', v_dn, v_color)
  on conflict (session_id, user_id) do update
    set display_name = excluded.display_name,
        color = coalesce(p_color, public.session_members.color);

  return v_sid;
end $$;

create or replace function public.assign_character(p_character_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_sid uuid;
begin
  perform private.require_uid();
  select c.session_id into v_sid from public.characters c where c.id = p_character_id and c.kind = 'pc';
  if v_sid is null then perform private.fail('not_found'); end if;
  if not private.is_session_gm(v_sid) then perform private.fail('not_gm'); end if;
  if p_user_id is not null and not exists (
       select 1 from public.session_members m where m.session_id = v_sid and m.user_id = p_user_id) then
    perform private.fail('not_member');
  end if;
  update public.characters set owner_id = p_user_id where id = p_character_id;
end $$;

-- ---------------------------------------------------------------------------
-- Sheets (invoker: RLS decides who may write)
-- ---------------------------------------------------------------------------

-- Insert sections and blocks from the export format (SPEC §5.6) into an empty sheet.
create or replace function private.write_sheet_contents(p_character_id uuid, p_sheet jsonb)
returns void language plpgsql set search_path = '' as $$
begin
  if jsonb_typeof(p_sheet -> 'sections') is distinct from 'array'
     or jsonb_typeof(p_sheet -> 'blocks') is distinct from 'array' then
    perform private.fail('invalid_input');
  end if;

  insert into public.sheet_sections (character_id, id, title, position)
  select p_character_id, e ->> 'id', e ->> 'title', t.ord * 1024
  from jsonb_array_elements(p_sheet -> 'sections') with ordinality as t(e, ord);

  insert into public.sheet_blocks (character_id, id, section_id, type, label, value, props, position)
  select p_character_id, e ->> 'id', e ->> 'section', e ->> 'type', coalesce(e ->> 'label', ''),
         e -> 'value', e - array['id','section','type','label','value'], t.ord * 1024
  from jsonb_array_elements(p_sheet -> 'blocks') with ordinality as t(e, ord);
end $$;

create or replace function public.create_character(p_session_id uuid, p_sheet jsonb)
returns uuid language plpgsql set search_path = '' as $$
declare
  v_kind text := coalesce(p_sheet ->> 'kind', 'pc');
  v_id   uuid;
begin
  perform private.require_uid();
  if v_kind not in ('pc','npc') then perform private.fail('invalid_input'); end if;
  if v_kind = 'npc' and not private.is_session_gm(p_session_id) then perform private.fail('not_gm'); end if;
  if not private.is_session_member(p_session_id) then perform private.fail('not_member'); end if;

  insert into public.characters (session_id, kind, owner_id, name, template, fate_points, refresh, position)
  values (
    p_session_id, v_kind,
    case when v_kind = 'pc' then auth.uid() end,
    coalesce(nullif(btrim(p_sheet ->> 'name'), ''), 'Unnamed'),
    coalesce(p_sheet ->> 'template', case when v_kind = 'npc' then 'npc' else 'blank' end),
    coalesce((p_sheet ->> 'fate_points')::int, 3),
    coalesce((p_sheet ->> 'refresh')::int, 3),
    coalesce((p_sheet ->> 'position')::double precision, extract(epoch from now()))
  ) returning id into v_id;

  perform private.write_sheet_contents(v_id, p_sheet);
  return v_id;
end $$;

create or replace function public.replace_sheet(p_character_id uuid, p_sheet jsonb)
returns void language plpgsql set search_path = '' as $$
begin
  perform private.require_uid();
  if not private.can_edit_character(p_character_id) then perform private.fail('not_allowed'); end if;

  update public.characters set
    name        = coalesce(nullif(btrim(p_sheet ->> 'name'), ''), name),
    template    = coalesce(p_sheet ->> 'template', template),
    fate_points = coalesce((p_sheet ->> 'fate_points')::int, fate_points),
    refresh     = coalesce((p_sheet ->> 'refresh')::int, refresh)
  where id = p_character_id;

  delete from public.sheet_blocks where character_id = p_character_id;
  delete from public.sheet_sections where character_id = p_character_id;
  perform private.write_sheet_contents(p_character_id, p_sheet);
end $$;

create or replace function public.patch_block(p_character_id uuid, p_block_id text, p_patch jsonb)
returns public.sheet_blocks language plpgsql set search_path = '' as $$
declare r public.sheet_blocks;
begin
  if jsonb_typeof(p_patch) is distinct from 'object' then perform private.fail('invalid_input'); end if;

  update public.sheet_blocks b set
    label      = case when p_patch ? 'label'      then coalesce(p_patch ->> 'label', '') else b.label end,
    value      = case when p_patch ? 'value'      then p_patch -> 'value' else b.value end,
    type       = case when p_patch ? 'type'       then p_patch ->> 'type' else b.type end,
    section_id = case when p_patch ? 'section_id' then p_patch ->> 'section_id' else b.section_id end,
    position   = case when p_patch ? 'position'   then (p_patch ->> 'position')::double precision else b.position end,
    props      = case when p_patch ? 'props'      then jsonb_strip_nulls(b.props || (p_patch -> 'props')) else b.props end
  where b.character_id = p_character_id and b.id = p_block_id
  returning b.* into r;

  if not found then perform private.fail('block_not_found'); end if;
  return r;
end $$;

create or replace function public.set_stress_box(p_character_id uuid, p_block_id text, p_index int, p_checked boolean)
returns public.sheet_blocks language plpgsql set search_path = '' as $$
declare r public.sheet_blocks;
begin
  update public.sheet_blocks b
     set value = jsonb_set(b.value, array[p_index::text, 'checked'], to_jsonb(coalesce(p_checked, false)))
   where b.character_id = p_character_id and b.id = p_block_id and b.type = 'stress'
     and p_index >= 0 and p_index < jsonb_array_length(b.value)
  returning b.* into r;
  if not found then perform private.fail('block_not_found'); end if;
  return r;
end $$;

create or replace function public.adjust_block_value(p_character_id uuid, p_block_id text, p_delta numeric)
returns public.sheet_blocks language plpgsql set search_path = '' as $$
declare r public.sheet_blocks;
begin
  update public.sheet_blocks b
     set value = to_jsonb(case
       when b.type = 'counter' then
         greatest(0, least(coalesce((b.props ->> 'max')::numeric, 'infinity'::numeric),
                           (b.value #>> '{}')::numeric + trunc(p_delta)))
       when b.type = 'skill' then (b.value #>> '{}')::numeric + trunc(p_delta)
       else (b.value #>> '{}')::numeric + p_delta
     end)
   where b.character_id = p_character_id and b.id = p_block_id and b.type in ('skill','counter','number')
  returning b.* into r;
  if not found then perform private.fail('block_not_found'); end if;
  return r;
end $$;

create or replace function public.delete_section(p_character_id uuid, p_section_id text, p_with_blocks boolean default false)
returns void language plpgsql set search_path = '' as $$
begin
  if not private.can_edit_character(p_character_id) then perform private.fail('not_allowed'); end if;
  if not coalesce(p_with_blocks, false) and exists (
       select 1 from public.sheet_blocks b where b.character_id = p_character_id and b.section_id = p_section_id) then
    perform private.fail('section_not_empty');
  end if;
  delete from public.sheet_blocks where character_id = p_character_id and section_id = p_section_id;
  delete from public.sheet_sections where character_id = p_character_id and id = p_section_id;
  if not found then perform private.fail('not_found'); end if;
end $$;

create or replace function public.rebalance_positions(p_character_id uuid)
returns void language plpgsql set search_path = '' as $$
begin
  if not private.can_edit_character(p_character_id) then perform private.fail('not_allowed'); end if;

  update public.sheet_sections s set position = o.rn * 1024
  from (select id, row_number() over (order by position, id) as rn
        from public.sheet_sections where character_id = p_character_id) o
  where s.character_id = p_character_id and s.id = o.id and s.position <> o.rn * 1024;

  update public.sheet_blocks b set position = o.rn * 1024
  from (select id, row_number() over (partition by section_id order by position, id) as rn
        from public.sheet_blocks where character_id = p_character_id) o
  where b.character_id = p_character_id and b.id = o.id and b.position <> o.rn * 1024;
end $$;

create or replace function public.adjust_fate_points(p_character_id uuid, p_delta int)
returns int language plpgsql set search_path = '' as $$
declare
  v_fp    int;
  v_sid   uuid;
  v_owner uuid;
  v_kind  text;
begin
  perform private.require_uid();
  update public.characters c set fate_points = greatest(0, c.fate_points + coalesce(p_delta, 0))
   where c.id = p_character_id
  returning c.fate_points, c.session_id, c.owner_id, c.kind into v_fp, v_sid, v_owner, v_kind;
  if not found then perform private.fail('not_allowed'); end if;

  if p_delta <> 0 and v_kind = 'pc' and v_owner is distinct from auth.uid() and private.is_session_gm(v_sid) then
    perform private.emit_event(v_sid,
      case when p_delta > 0 then 'fate_point_awarded' else 'fate_point_taken' end,
      p_character_id, jsonb_build_object('delta', p_delta, 'fate_points', v_fp));
  end if;
  return v_fp;
end $$;

create or replace function public.adjust_gm_pool(p_session_id uuid, p_delta int)
returns int language plpgsql set search_path = '' as $$
declare v int;
begin
  update public.sessions s set gm_fate_points = greatest(0, s.gm_fate_points + coalesce(p_delta, 0))
   where s.id = p_session_id
  returning s.gm_fate_points into v;
  if not found then perform private.fail('not_gm'); end if;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Dice
-- ---------------------------------------------------------------------------

create or replace function public.roll_dice(
  p_session_id   uuid,
  p_character_id uuid    default null,
  p_block_id     text    default null,
  p_bonus        int     default 0,
  p_label        text    default null,
  p_hidden       boolean default null)
returns public.rolls language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := private.require_uid();
  v_member public.session_members;
  v_is_gm  boolean;
  v_hidden boolean;
  v_char   public.characters;
  v_block  public.sheet_blocks;
  v_name   text;
  v_label  text := nullif(btrim(coalesce(p_label, '')), '');
  v_skill  int := 0;
  v_bonus  int := greatest(-20, least(20, coalesce(p_bonus, 0)));
  v_faces  smallint[];
  v_dice   int;
  r        public.rolls;
begin
  select * into v_member from public.session_members m where m.session_id = p_session_id and m.user_id = v_uid;
  if not found then perform private.fail('not_member'); end if;
  v_is_gm := v_member.role = 'gm';
  v_name := v_member.display_name;

  v_hidden := coalesce(p_hidden,
    v_is_gm and (select s.gm_roll_mode from public.sessions s where s.id = p_session_id) = 'closed');
  if v_hidden and not v_is_gm then perform private.fail('not_gm'); end if;

  if p_block_id is not null and p_character_id is null then perform private.fail('invalid_input'); end if;

  if p_character_id is not null then
    select * into v_char from public.characters c where c.id = p_character_id and c.session_id = p_session_id;
    if not found then perform private.fail('not_found'); end if;
    if v_char.kind = 'npc' and not v_is_gm then perform private.fail('not_gm'); end if;
    if not (v_is_gm or (v_char.kind = 'pc' and v_char.owner_id = v_uid)) then perform private.fail('not_allowed'); end if;
    if v_is_gm then v_name := 'GM · ' || v_char.name; end if;

    if p_block_id is not null then
      select * into v_block from public.sheet_blocks b
       where b.character_id = p_character_id and b.id = p_block_id and b.type = 'skill';
      if not found then perform private.fail('block_not_found'); end if;
      v_skill := (v_block.value #>> '{}')::int;
      v_label := coalesce(v_label, nullif(v_block.label, ''), 'Unnamed skill');
    end if;
  end if;

  v_faces := array[
    floor(random() * 3)::int - 1, floor(random() * 3)::int - 1,
    floor(random() * 3)::int - 1, floor(random() * 3)::int - 1]::smallint[];
  v_dice := v_faces[1] + v_faces[2] + v_faces[3] + v_faces[4];

  insert into public.rolls (session_id, user_id, character_id, roller_name, roller_color, is_hidden,
                            label, skill_value, bonus, faces, dice_total, total)
  values (p_session_id, v_uid, p_character_id, v_name, v_member.color, v_hidden,
          v_label, v_skill, v_bonus, v_faces, v_dice, v_dice + v_skill + v_bonus)
  returning * into r;

  if v_hidden then
    perform private.emit_event(p_session_id, 'hidden_roll', null,
      jsonb_build_object('roll_id', r.id, 'roller_name', r.roller_name, 'roller_color', r.roller_color));
  end if;
  return r;
end $$;

create or replace function public.reveal_roll(p_roll_id uuid)
returns public.rolls language plpgsql security definer set search_path = '' as $$
declare r public.rolls;
begin
  perform private.require_uid();
  select * into r from public.rolls x where x.id = p_roll_id;
  if not found or not private.is_session_gm(r.session_id) then perform private.fail('not_gm'); end if;
  if r.is_hidden then
    update public.rolls x set is_hidden = false, revealed_at = now() where x.id = p_roll_id returning * into r;
    perform private.emit_event(r.session_id, 'visibility_changed', null,
      jsonb_build_object('table', 'rolls', 'id', r.id));
  end if;
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- Spotlight
-- ---------------------------------------------------------------------------

create or replace function public.set_spotlight(
  p_session_id      uuid,
  p_character_id    uuid default null,
  p_block_id        text default null,
  p_scene_aspect_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_uid();
  v_sp   jsonb;
  v_a    record;
  v_b    record;
begin
  if not private.is_session_gm(p_session_id) then perform private.fail('not_gm'); end if;

  if p_character_id is null and p_block_id is null and p_scene_aspect_id is null then
    v_sp := null;
  elsif p_scene_aspect_id is not null then
    select a.id, a.text, a.free_invokes, z.title as zone_title into v_a
      from public.scene_aspects a
      join public.sessions s on s.id = a.session_id and s.active_scene_id = a.scene_id
      left join public.scene_zones z on z.id = a.zone_id
     where a.id = p_scene_aspect_id and a.session_id = p_session_id;
    if not found then perform private.fail('invalid_spotlight'); end if;
    v_sp := jsonb_build_object('kind', 'scene_aspect', 'scene_aspect_id', v_a.id, 'text', v_a.text,
              'free_invokes', v_a.free_invokes, 'zone_title', v_a.zone_title);
  elsif p_character_id is not null and p_block_id is not null then
    select b.id, b.type, b.label, b.value #>> '{}' as text, b.props, c.id as character_id, c.name, c.kind,
           c.visible_to_players, c.owner_id into v_b
      from public.sheet_blocks b
      join public.characters c on c.id = b.character_id
     where b.character_id = p_character_id and b.id = p_block_id and c.session_id = p_session_id
       and b.type in ('aspect','consequence') and coalesce(b.value #>> '{}', '') <> '';
    if not found then perform private.fail('invalid_spotlight'); end if;
    v_sp := jsonb_build_object('kind', 'block', 'character_id', v_b.character_id, 'block_id', v_b.id,
              'block_type', v_b.type, 'label', v_b.label, 'text', v_b.text,
              'free_invokes', v_b.props -> 'free_invokes', 'character_kind', v_b.kind,
              'owner_id', v_b.owner_id,
              -- hidden NPCs: don't reveal whose aspect it is
              'character_name', case when v_b.kind = 'pc' or v_b.visible_to_players then v_b.name end);
  else
    perform private.fail('invalid_spotlight');
  end if;

  if v_sp is not null then
    v_sp := jsonb_strip_nulls(v_sp) || jsonb_build_object('set_at', now(), 'by', v_uid);
  end if;
  update public.sessions set spotlight = v_sp where id = p_session_id;
  return v_sp;
end $$;

-- ---------------------------------------------------------------------------
-- Scenes (invoker: GM through RLS)
-- ---------------------------------------------------------------------------

create or replace function public.duplicate_scene(p_scene_id uuid)
returns uuid language plpgsql set search_path = '' as $$
declare
  v_src  public.scenes;
  v_new  uuid;
  v_zone record;
  v_nz   uuid;
begin
  select * into v_src from public.scenes s where s.id = p_scene_id;
  if not found or not private.is_session_gm(v_src.session_id) then perform private.fail('not_gm'); end if;

  insert into public.scenes (session_id, name, kind, position)
  values (v_src.session_id, left(v_src.name || ' (copy)', 80), v_src.kind, v_src.position + 0.5)
  returning id into v_new;

  for v_zone in select * from public.scene_zones z where z.scene_id = p_scene_id loop
    insert into public.scene_zones (scene_id, title, color, x, y, w, h, z)
    values (v_new, v_zone.title, v_zone.color, v_zone.x, v_zone.y, v_zone.w, v_zone.h, v_zone.z)
    returning id into v_nz;
    insert into public.scene_aspects (scene_id, zone_id, text, free_invokes, position)
    select v_new, v_nz, a.text, a.free_invokes, a.position
      from public.scene_aspects a where a.scene_id = p_scene_id and a.zone_id = v_zone.id;
  end loop;

  insert into public.scene_aspects (scene_id, zone_id, text, free_invokes, position)
  select v_new, null, a.text, a.free_invokes, a.position
    from public.scene_aspects a where a.scene_id = p_scene_id and a.zone_id is null;

  insert into public.scene_tokens (scene_id, character_id, label, color, x, y)
  select v_new, t.character_id, t.label, t.color, t.x, t.y
    from public.scene_tokens t where t.scene_id = p_scene_id;

  return v_new;
end $$;

create or replace function public.bring_to_front(p_zone_id uuid)
returns int language plpgsql set search_path = '' as $$
declare v int;
begin
  update public.scene_zones t
     set z = (select coalesce(max(o.z), 0) + 1 from public.scene_zones o where o.scene_id = t.scene_id)
   where t.id = p_zone_id
  returning t.z into v;
  if not found then perform private.fail('not_gm'); end if;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

-- Internal helpers: callable from inside RPCs/triggers/policies by the client role,
-- but not reachable through the API (the private schema isn't exposed).
grant execute on all functions in schema private to authenticated;
revoke execute on function private.gm_pepper(), private.gm_code_hash(text) from authenticated;

-- Public RPCs: signed-in users only.
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.create_session(text, text, text, text),
  public.claim_gm(text),
  public.change_gm_code(uuid, text),
  public.join_session(text, text, text),
  public.assign_character(uuid, uuid),
  public.create_character(uuid, jsonb),
  public.replace_sheet(uuid, jsonb),
  public.patch_block(uuid, text, jsonb),
  public.set_stress_box(uuid, text, int, boolean),
  public.adjust_block_value(uuid, text, numeric),
  public.delete_section(uuid, text, boolean),
  public.rebalance_positions(uuid),
  public.adjust_fate_points(uuid, int),
  public.adjust_gm_pool(uuid, int),
  public.roll_dice(uuid, uuid, text, int, text, boolean),
  public.reveal_roll(uuid),
  public.set_spotlight(uuid, uuid, text, uuid),
  public.duplicate_scene(uuid),
  public.bring_to_front(uuid)
to authenticated;
