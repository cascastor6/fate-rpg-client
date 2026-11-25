-- Fate Table: row-level security and grants (SPEC §4.2, §4.3).
-- Clients use the `authenticated` role (anonymous Supabase users included).
-- `anon` (no session at all) gets nothing.

-- ---------------------------------------------------------------------------
-- Access helpers (definer so policies don't recurse through RLS)
-- ---------------------------------------------------------------------------

create or replace function private.can_view_character(p_character_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.characters c
    where c.id = p_character_id
      and private.is_session_member(c.session_id)
      and (c.kind = 'pc' or c.visible_to_players or private.is_session_gm(c.session_id))
  )
$$;

create or replace function private.can_edit_character(p_character_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.characters c
    where c.id = p_character_id
      and (
        (c.kind = 'pc' and c.owner_id = (select auth.uid()) and private.is_session_member(c.session_id))
        or private.is_session_gm(c.session_id)
      )
  )
$$;

create or replace function private.can_view_scene(p_scene_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.scenes s
    join public.sessions x on x.id = s.session_id
    where s.id = p_scene_id
      and (
        private.is_session_gm(s.session_id)
        or (private.is_session_member(s.session_id) and x.active_scene_id = s.id)
      )
  )
$$;

revoke all on all functions in schema private from public;
grant execute on function
  private.is_session_member(uuid),
  private.is_session_gm(uuid),
  private.can_view_character(uuid),
  private.can_edit_character(uuid),
  private.can_view_scene(uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------

alter table public.sessions         enable row level security;
alter table public.session_secrets  enable row level security;
alter table public.gm_code_attempts enable row level security;
alter table public.session_members  enable row level security;
alter table public.characters       enable row level security;
alter table public.sheet_sections   enable row level security;
alter table public.sheet_blocks     enable row level security;
alter table public.rolls            enable row level security;
alter table public.scenes           enable row level security;
alter table public.scene_zones      enable row level security;
alter table public.scene_aspects    enable row level security;
alter table public.scene_tokens     enable row level security;
alter table public.session_events   enable row level security;

-- ---------------------------------------------------------------------------
-- Grants: start from nothing, then add exactly what the policies need.
-- Supabase grants everything to anon/authenticated by default, so revoke first.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated, public;

grant select, delete                                                    on public.sessions to authenticated;
grant update (name, gm_fate_points, gm_roll_mode, active_scene_id)      on public.sessions to authenticated;

grant select, delete                                                    on public.session_members to authenticated;
grant update (display_name, color)                                      on public.session_members to authenticated;

grant select, delete                                                    on public.characters to authenticated;
grant insert (id, session_id, kind, owner_id, name, template, fate_points, refresh, visible_to_players, position)
                                                                        on public.characters to authenticated;
grant update (name, fate_points, refresh, template, visible_to_players, position, owner_id)
                                                                        on public.characters to authenticated;

grant select, delete                                                    on public.sheet_sections to authenticated;
grant insert (character_id, id, title, position)                        on public.sheet_sections to authenticated;
grant update (title, position)                                          on public.sheet_sections to authenticated;

grant select, delete                                                    on public.sheet_blocks to authenticated;
grant insert (character_id, id, section_id, type, label, value, props, position)
                                                                        on public.sheet_blocks to authenticated;
grant update (section_id, type, label, value, props, position)          on public.sheet_blocks to authenticated;

grant select                                                            on public.rolls to authenticated;

grant select, delete                                                    on public.scenes to authenticated;
grant insert (id, session_id, name, kind, position)                     on public.scenes to authenticated;
grant update (name, kind, position)                                     on public.scenes to authenticated;

grant select, delete                                                    on public.scene_zones to authenticated;
grant insert (id, scene_id, title, color, x, y, w, h, z)                on public.scene_zones to authenticated;
grant update (title, color, x, y, w, h, z)                              on public.scene_zones to authenticated;

grant select, delete                                                    on public.scene_aspects to authenticated;
grant insert (id, scene_id, zone_id, text, free_invokes, position)      on public.scene_aspects to authenticated;
grant update (zone_id, text, free_invokes, position)                    on public.scene_aspects to authenticated;

grant select, delete                                                    on public.scene_tokens to authenticated;
grant insert (id, scene_id, character_id, label, color, x, y)           on public.scene_tokens to authenticated;
grant update (character_id, label, color, x, y)                         on public.scene_tokens to authenticated;

grant select                                                            on public.session_events to authenticated;

-- session_secrets and gm_code_attempts: no grants, no policies. Only definer RPCs touch them.

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

-- sessions
create policy sessions_select on public.sessions for select to authenticated
  using (private.is_session_member(id));
create policy sessions_update on public.sessions for update to authenticated
  using (private.is_session_gm(id)) with check (private.is_session_gm(id));
create policy sessions_delete on public.sessions for delete to authenticated
  using (private.is_session_gm(id));

-- session_members
create policy members_select on public.session_members for select to authenticated
  using (private.is_session_member(session_id));
create policy members_update_own on public.session_members for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy members_delete on public.session_members for delete to authenticated
  using (user_id = (select auth.uid()) or private.is_session_gm(session_id));

-- characters
create policy characters_select on public.characters for select to authenticated
  using (
    private.is_session_member(session_id)
    and (kind = 'pc' or visible_to_players or private.is_session_gm(session_id))
  );
create policy characters_insert on public.characters for insert to authenticated
  with check (
    private.is_session_member(session_id)
    and (
      (kind = 'pc' and owner_id = (select auth.uid()))
      or private.is_session_gm(session_id)
    )
  );
create policy characters_update on public.characters for update to authenticated
  using (
    (kind = 'pc' and owner_id = (select auth.uid()) and private.is_session_member(session_id))
    or private.is_session_gm(session_id)
  )
  with check (
    (kind = 'pc' and owner_id = (select auth.uid()) and private.is_session_member(session_id))
    or private.is_session_gm(session_id)
  );
create policy characters_delete on public.characters for delete to authenticated
  using (
    (kind = 'pc' and owner_id = (select auth.uid()) and private.is_session_member(session_id))
    or private.is_session_gm(session_id)
  );

-- sheet_sections
create policy sections_select on public.sheet_sections for select to authenticated
  using (private.can_view_character(character_id));
create policy sections_insert on public.sheet_sections for insert to authenticated
  with check (private.can_edit_character(character_id));
create policy sections_update on public.sheet_sections for update to authenticated
  using (private.can_edit_character(character_id)) with check (private.can_edit_character(character_id));
create policy sections_delete on public.sheet_sections for delete to authenticated
  using (private.can_edit_character(character_id));

-- sheet_blocks
create policy blocks_select on public.sheet_blocks for select to authenticated
  using (private.can_view_character(character_id));
create policy blocks_insert on public.sheet_blocks for insert to authenticated
  with check (private.can_edit_character(character_id));
create policy blocks_update on public.sheet_blocks for update to authenticated
  using (private.can_edit_character(character_id)) with check (private.can_edit_character(character_id));
create policy blocks_delete on public.sheet_blocks for delete to authenticated
  using (private.can_edit_character(character_id));

-- rolls: read-only to clients; closed GM rolls only reach GMs
create policy rolls_select on public.rolls for select to authenticated
  using (private.is_session_member(session_id) and (not is_hidden or private.is_session_gm(session_id)));

-- scenes: players see only the active scene
-- Inline (not can_view_scene) so INSERT ... RETURNING can see the row it just created.
create policy scenes_select on public.scenes for select to authenticated
  using (
    private.is_session_gm(session_id)
    or (private.is_session_member(session_id)
        and id = (select x.active_scene_id from public.sessions x where x.id = session_id))
  );
create policy scenes_insert on public.scenes for insert to authenticated
  with check (private.is_session_gm(session_id));
create policy scenes_update on public.scenes for update to authenticated
  using (private.is_session_gm(session_id)) with check (private.is_session_gm(session_id));
create policy scenes_delete on public.scenes for delete to authenticated
  using (private.is_session_gm(session_id));

-- scene children
create policy zones_select on public.scene_zones for select to authenticated
  using (private.can_view_scene(scene_id));
create policy zones_insert on public.scene_zones for insert to authenticated
  with check (private.is_session_gm(session_id));
create policy zones_update on public.scene_zones for update to authenticated
  using (private.is_session_gm(session_id)) with check (private.is_session_gm(session_id));
create policy zones_delete on public.scene_zones for delete to authenticated
  using (private.is_session_gm(session_id));

create policy scene_aspects_select on public.scene_aspects for select to authenticated
  using (private.can_view_scene(scene_id));
create policy scene_aspects_insert on public.scene_aspects for insert to authenticated
  with check (private.is_session_gm(session_id));
create policy scene_aspects_update on public.scene_aspects for update to authenticated
  using (private.is_session_gm(session_id)) with check (private.is_session_gm(session_id));
create policy scene_aspects_delete on public.scene_aspects for delete to authenticated
  using (private.is_session_gm(session_id));

create policy tokens_select on public.scene_tokens for select to authenticated
  using (private.can_view_scene(scene_id));
create policy tokens_insert on public.scene_tokens for insert to authenticated
  with check (private.is_session_gm(session_id));
create policy tokens_update on public.scene_tokens for update to authenticated
  using (private.is_session_gm(session_id)) with check (private.is_session_gm(session_id));
create policy tokens_delete on public.scene_tokens for delete to authenticated
  using (private.is_session_gm(session_id));

-- session_events: read-only to members
create policy events_select on public.session_events for select to authenticated
  using (private.is_session_member(session_id));
