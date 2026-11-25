-- Fate Table: GM-made sheet templates (SPEC §5.7).
-- A template is a character with kind = 'template', so it reuses the sheet tables,
-- the block editor and RLS. Only the GM can create or edit one. Players can read it
-- once the GM sets visible_to_players ("Offer to players"); drafts stay GM-only,
-- exactly like hidden NPCs (the characters SELECT policy is unchanged).

alter table public.characters drop constraint characters_kind_check;
alter table public.characters add constraint characters_kind_check check (kind in ('pc','npc','template'));

-- create_character: allow kind 'template' (GM only, like NPCs).
create or replace function public.create_character(p_session_id uuid, p_sheet jsonb)
returns uuid language plpgsql set search_path = '' as $$
declare
  v_kind text := coalesce(p_sheet ->> 'kind', 'pc');
  v_id   uuid;
begin
  perform private.require_uid();
  if v_kind not in ('pc','npc','template') then perform private.fail('invalid_input'); end if;
  if v_kind <> 'pc' and not private.is_session_gm(p_session_id) then perform private.fail('not_gm'); end if;
  if not private.is_session_member(p_session_id) then perform private.fail('not_member'); end if;

  insert into public.characters (session_id, kind, owner_id, name, template, fate_points, refresh, position)
  values (
    p_session_id, v_kind,
    case when v_kind = 'pc' then auth.uid() end,
    coalesce(nullif(btrim(p_sheet ->> 'name'), ''), 'Unnamed'),
    coalesce(nullif(p_sheet ->> 'template', 'custom'), case when v_kind = 'npc' then 'npc' else 'blank' end),
    coalesce((p_sheet ->> 'fate_points')::int, 3),
    coalesce((p_sheet ->> 'refresh')::int, 3),
    coalesce((p_sheet ->> 'position')::double precision, extract(epoch from now()))
  ) returning id into v_id;

  perform private.write_sheet_contents(v_id, p_sheet);
  return v_id;
end $$;

-- roll_dice: templates can't be rolled.
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
    if v_char.kind = 'template' then perform private.fail('not_allowed'); end if;
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

-- set_spotlight: template blocks can't be highlighted.
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
       and c.kind <> 'template'
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

grant execute on function
  public.create_character(uuid, jsonb),
  public.roll_dice(uuid, uuid, text, int, text, boolean),
  public.set_spotlight(uuid, uuid, text, uuid)
to authenticated;
