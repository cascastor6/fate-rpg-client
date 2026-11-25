-- Fate Table: the "gear" block type (SPEC §5.2).
-- label = gear name, value = effect text ('' when none), props.quantity = optional count.

alter table public.sheet_blocks drop constraint sheet_blocks_type_check;
alter table public.sheet_blocks add constraint sheet_blocks_type_check check (type in
  ('text','aspect','skill','stress','consequence','counter','number','image','separator','gear'));

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
    when 'text', 'aspect', 'consequence', 'image', 'gear' then
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
    when 'gear'        then array['quantity']
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
  foreach v_key in array array['shift','free_invokes','max','refresh','quantity'] loop
    if new.props ? v_key then
      if jsonb_typeof(new.props->v_key) <> 'number' then perform private.fail('invalid_block'); end if;
      v_num := (new.props->>v_key)::numeric;
      if v_num <> trunc(v_num) or v_num < 0 or v_num > 999 then perform private.fail('invalid_block'); end if;
    end if;
  end loop;

  return new;
end $$;
