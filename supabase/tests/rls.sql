-- Plain-SQL RLS test (run by scripts/rls-test-local.sh). Mirrors scripts/rls-test.mjs.
\set ON_ERROR_STOP 1
\set QUIET 1
-- users
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'),('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000a2'),('00000000-0000-0000-0000-00000000000b'),('00000000-0000-0000-0000-0000000000b0');
create or replace function public.t_ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond then raise notice 'PASS %', msg; else raise exception 'FAIL %', msg; end if; end $$;
grant execute on function public.t_ok(boolean,text) to authenticated;
-- run sql, expect an error whose message matches
create or replace function public.t_err(q text, expect text, msg text) returns void language plpgsql as $$
begin execute q; raise exception 'FAIL % (no error)', msg;
exception when others then
  if sqlerrm like 'FAIL %' then raise; end if;
  if expect is null or sqlerrm ~ expect then raise notice 'PASS % (%)', msg, sqlerrm;
  else raise exception 'FAIL % (got %)', msg, sqlerrm; end if;
end $$;
grant execute on function public.t_err(text,text,text) to authenticated;
-- run sql returning affected-row count
create or replace function public.t_rows(q text) returns bigint language plpgsql as $$
declare n bigint; begin execute q; get diagnostics n = row_count; return n; end $$;
grant execute on function public.t_rows(text) to authenticated;

\set GM   '\'{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}\''
\set A1   '\'{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}\''
\set A2   '\'{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}\''
\set B    '\'{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}\''
\set GB   '\'{"sub":"00000000-0000-0000-0000-0000000000b0","role":"authenticated"}\''

-- anon gets nothing
set role anon;
select t_err('select * from public.sessions', 'permission denied', 'anon cannot read sessions');
select t_err('select public.claim_gm(''whatever whatever'')', 'permission denied', 'anon cannot call RPCs');
reset role;

-- GM A creates session A
select set_config('request.jwt.claims', :GM, false); set role authenticated;
select t_err($$select public.create_session('short', 'X', 'Sam')$$, 'weak_gm_code', 'weak code rejected');
select t_err($$select public.create_session('password 123', 'X', 'Sam')$$, 'weak_gm_code', 'blocklisted code rejected');
select (public.create_session('Ember Lantern Otter Quarry', 'Session A', 'Sam', 'red'))->>'session_id' as sa \gset
select invite_code as inv_a from sessions where id = :'sa' \gset
select t_err($$select public.create_session('ember-lantern  otter.quarry', 'Y', 'Sam')$$, 'gm_code_taken', 'same code (different spelling) is taken');
reset role;

-- GM B creates session B; player B joins it
select set_config('request.jwt.claims', :GB, false); set role authenticated;
select (public.create_session('brass kettle winter fox', 'Session B', 'Bo'))->>'session_id' as sb \gset
select invite_code as inv_b from sessions where id = :'sb' \gset
reset role;
select set_config('request.jwt.claims', :B, false); set role authenticated;
select public.join_session(:'inv_b', 'Bea B') is not null as joined_b;
reset role;

-- A1, A2 join A (invite code is case/space-insensitive)
select set_config('request.jwt.claims', :A1, false); set role authenticated;
select t_err($$select public.join_session('ZZZZZZ', 'Al')$$, 'invalid_invite', 'unknown invite rejected');
select t_ok((public.session_preview(:'inv_a')) ->> 'name' = 'Session A', 'session_preview shows the name before joining');
select t_ok((public.session_preview(:'inv_a')) -> 'taken_colors' = '["red"]', 'session_preview lists taken colours');
select t_err($$select public.session_preview('ZZZZZZ')$$, 'invalid_invite', 'session_preview rejects unknown invite');
select t_ok(public.join_session(lower(:'inv_a'), 'Al') = :'sa', 'A1 joins with lower-case invite');
select t_ok((select color from session_members where user_id = auth.uid()) <> 'red', 'A1 got an unused colour');
select public.create_character(:'sa', '{"kind":"pc","name":"Aldric","template":"core",
  "sections":[{"id":"s_aspects","title":"Aspects"},{"id":"s_skills","title":"Skills"},{"id":"s_stress","title":"Stress"}],
  "blocks":[{"id":"b_hc00000001","type":"aspect","label":"High Concept","value":"Disgraced Knight","section":"s_aspects","role":"high_concept"},
            {"id":"b_fight00001","type":"skill","label":"Fight","value":3,"section":"s_skills","rollable":true},
            {"id":"b_phys000001","type":"stress","label":"Physical","section":"s_stress","value":[{"size":1,"checked":false},{"size":2,"checked":false}]}]}'::jsonb) as c1 \gset
select t_ok((select count(*) from sheet_blocks where character_id = :'c1') = 3, 'A1 created a sheet with 3 blocks');
select t_err($$select public.create_character('$$ || :'sa' || $$', '{"kind":"npc","name":"x","sections":[],"blocks":[]}')$$, 'not_gm', 'player cannot create NPC');
select t_err($$insert into public.sheet_blocks(character_id,id,section_id,type,label,value,position) values ('$$ || :'c1' || $$','b_bad0000001','s_skills','skill','x','"three"',1)$$, 'invalid_block', 'validation rejects a string skill value');
select t_err($$insert into public.sheet_blocks(character_id,id,section_id,type,label,value,props,position) values ('$$ || :'c1' || $$','b_bad0000002','s_skills','skill','x','1','{"evil":1}',1)$$, 'invalid_block', 'validation rejects unknown props');
select t_ok((public.adjust_block_value(:'c1', 'b_fight00001', 1)).value = '4'::jsonb, 'A1 adjusts own skill');
select t_ok((public.set_stress_box(:'c1', 'b_phys000001', 1, true)).value -> 1 ->> 'checked' = 'true', 'A1 ticks own stress');
select t_ok((public.patch_block(:'c1', 'b_hc00000001', '{"value":"Knight Errant","props":{"role":"high_concept"}}')).value = '"Knight Errant"', 'A1 patches own aspect');
select t_err($$update public.characters set owner_id = null where id = '$$ || :'c1' || $$'$$, 'not_gm', 'player cannot change owner');
reset role;

select set_config('request.jwt.claims', :A2, false); set role authenticated;
select public.join_session(:'inv_a', 'Ann') as j2 \gset
select t_ok((select count(*) from sheet_blocks where character_id = :'c1') = 3, 'A2 can READ A1''s blocks');
select t_ok((select name from characters where id = :'c1') = 'Aldric', 'A2 can read A1''s character');
select t_ok(t_rows($$update public.characters set name = 'Hacked' where id = '$$ || :'c1' || $$'$$) = 0, 'A2 cannot update A1''s character');
select t_ok(t_rows($$delete from public.characters where id = '$$ || :'c1' || $$'$$) = 0, 'A2 cannot delete A1''s character');
select t_ok(t_rows($$update public.sheet_blocks set label = 'x' where character_id = '$$ || :'c1' || $$'$$) = 0, 'A2 cannot update A1''s blocks');
select t_ok(t_rows($$delete from public.sheet_blocks where character_id = '$$ || :'c1' || $$'$$) = 0, 'A2 cannot delete A1''s blocks');
select t_err($$select public.patch_block('$$ || :'c1' || $$', 'b_hc00000001', '{"value":"pwned"}')$$, 'block_not_found', 'A2 patch_block on A1 refused');
select t_err($$select public.set_stress_box('$$ || :'c1' || $$', 'b_phys000001', 0, true)$$, 'block_not_found', 'A2 set_stress_box on A1 refused');
select t_err($$select public.adjust_fate_points('$$ || :'c1' || $$', 5)$$, 'not_allowed', 'A2 adjust_fate_points on A1 refused');
select t_err($$select public.roll_dice('$$ || :'sa' || $$', '$$ || :'c1' || $$', 'b_fight00001')$$, 'not_allowed', 'A2 cannot roll A1''s skill');
select t_err($$insert into public.sheet_blocks(character_id,id,section_id,type,label,value,position) values ('$$ || :'c1' || $$','b_evil000001','s_skills','skill','x','1',9)$$, 'row-level security', 'A2 cannot insert into A1''s sheet');
select t_err($$select public.replace_sheet('$$ || :'c1' || $$', '{"sections":[],"blocks":[]}')$$, 'not_allowed', 'A2 replace_sheet on A1 refused');
select t_err($$insert into public.rolls(session_id,roller_name,roller_color,faces,dice_total,total) values ('$$ || :'sa' || $$','x','red','{1,1,1,1}',4,4)$$, 'permission denied', 'player cannot insert rolls');
select t_err('select * from public.session_secrets', 'permission denied', 'player cannot read session_secrets');
select t_err('select * from public.gm_code_attempts', 'permission denied', 'player cannot read gm_code_attempts');
select t_ok(t_rows($$update public.sessions set name = 'mine' where id = '$$ || :'sa' || $$'$$) = 0, 'player cannot update session');
select t_err($$update public.sessions set spotlight = '{}' where id = '$$ || :'sa' || $$'$$, 'permission denied', 'player cannot write spotlight directly');
select t_ok(t_rows($$update public.sessions set active_scene_id = null where id = '$$ || :'sa' || $$'$$) = 0, 'player cannot change active scene');
select t_ok(t_rows($$update public.sessions set gm_roll_mode = 'closed' where id = '$$ || :'sa' || $$'$$) = 0, 'player cannot change gm_roll_mode');
select t_ok(t_rows($$update public.session_members set color = 'pink' where user_id = auth.uid()$$) = 1, 'player changes own colour');
select t_ok(t_rows($$update public.session_members set color = 'pink' where user_id <> auth.uid()$$) = 0, 'player cannot change another member''s colour');
select t_err($$update public.session_members set role = 'gm' where user_id = auth.uid()$$, 'permission denied', 'player cannot promote self');
select t_err($$select public.roll_dice('$$ || :'sa' || $$', p_hidden => true)$$, 'not_gm', 'player hidden roll refused');
select t_err($$select public.set_spotlight('$$ || :'sa' || $$', '$$ || :'c1' || $$', 'b_hc00000001')$$, 'not_gm', 'player set_spotlight refused');
select t_err($$select public.adjust_gm_pool('$$ || :'sa' || $$', 1)$$, 'not_gm', 'player cannot change GM pool');
select t_err($$insert into public.scenes(session_id,name) values ('$$ || :'sa' || $$','evil')$$, 'row-level security', 'player cannot create scenes');
select t_ok((select count(*) from scenes where session_id = :'sa') = 1, 'player sees the active scene (Scene 1)');
select (public.roll_dice(:'sa')).total between -4 and 4 as rolled;
reset role;

-- B (other session) sees nothing of A
select set_config('request.jwt.claims', :B, false); set role authenticated;
select t_ok((select count(*) from sessions where id = :'sa') = 0, 'B cannot see session A');
select t_ok((select count(*) from session_members where session_id = :'sa') = 0, 'B cannot see A members');
select t_ok((select count(*) from characters where session_id = :'sa') = 0, 'B cannot see A characters');
select t_ok((select count(*) from sheet_blocks where session_id = :'sa') = 0, 'B cannot see A blocks');
select t_ok((select count(*) from sheet_sections where session_id = :'sa') = 0, 'B cannot see A sections');
select t_ok((select count(*) from rolls where session_id = :'sa') = 0, 'B cannot see A rolls');
select t_ok((select count(*) from scenes where session_id = :'sa') = 0, 'B cannot see A scenes');
select t_ok((select count(*) from session_events where session_id = :'sa') = 0, 'B cannot see A events');
select t_err($$select public.roll_dice('$$ || :'sa' || $$')$$, 'not_member', 'B cannot roll in A');
select t_ok(t_rows($$update public.sheet_blocks set label='x' where character_id = '$$ || :'c1' || $$'$$) = 0, 'B cannot edit A1 blocks');
reset role;

-- GM A
select set_config('request.jwt.claims', :GM, false); set role authenticated;
select t_ok((select count(*) from sessions where id = :'sb') = 0, 'GM A cannot see session B');
select t_ok((public.patch_block(:'c1', 'b_hc00000001', '{"label":"HC"}')).label = 'HC', 'GM edits A1 block');
select t_ok(public.adjust_fate_points(:'c1', 1) = 4, 'GM awards A1 a fate point');
select t_ok((select gm_fate_points from sessions where id = :'sa') = 0, 'award does not touch GM pool');
select t_ok((select count(*) from session_events where kind = 'fate_point_awarded' and target_character_id = :'c1') = 1, 'award emitted an event');
select t_ok(public.adjust_gm_pool(:'sa', 2) = 2, 'GM adjusts pool manually');
-- NPC + prep scene
select public.create_character(:'sa', '{"kind":"npc","name":"Thug","template":"npc",
  "sections":[{"id":"s_aspects","title":"Aspects"}],
  "blocks":[{"id":"b_npca000001","type":"aspect","label":"Aspect","value":"Hired Muscle","section":"s_aspects"}]}'::jsonb) as npc \gset
insert into scenes(session_id, name, kind) values (:'sa', 'Docks (prep)', 'zones') returning id as prep \gset
insert into scene_zones(scene_id, title, x, y) values (:'prep', 'Pier', 100, 100) returning id as zone \gset
insert into scene_aspects(scene_id, zone_id, text) values (:'prep', :'zone', 'Slippery Planks') returning id as zasp \gset
insert into scene_tokens(scene_id, character_id, label, x, y) values (:'prep', :'npc', 'Thug', 200, 150);
select t_ok((select count(*) from session_events where kind = 'scene_aspect_added') = 0, 'aspect in a prep scene emits no toast event');
select t_err($$select public.set_spotlight('$$ || :'sa' || $$', p_scene_aspect_id => '$$ || :'zasp' || $$')$$, 'invalid_spotlight', 'cannot spotlight an aspect in a non-active scene');
select t_err($$select public.set_spotlight('$$ || :'sb' || $$', '$$ || :'c1' || $$', 'b_hc00000001')$$, 'not_gm', 'GM A cannot spotlight in session B');
select t_err($$select public.set_spotlight('$$ || :'sa' || $$', '$$ || :'c1' || $$', 'b_phys000001')$$, 'invalid_spotlight', 'cannot spotlight a stress block');
select t_ok((public.set_spotlight(:'sa', :'c1', 'b_hc00000001')) ->> 'text' = 'Knight Errant', 'GM spotlights A1 high concept');
select public.duplicate_scene(:'prep') is not null as dup;
select t_ok((select count(*) from scene_aspects a join scenes s on s.id = a.scene_id where s.name = 'Docks (prep) (copy)' and a.zone_id is not null) = 1, 'duplicate_scene copies zone aspects');
select t_ok(public.bring_to_front(:'zone') = 1, 'bring_to_front');
update sessions set gm_roll_mode = 'closed' where id = :'sa';
select (public.roll_dice(:'sa')).id as hidden_roll \gset
reset role;

-- A1: hidden things stay hidden
select set_config('request.jwt.claims', :A1, false); set role authenticated;
select t_ok((select count(*) from characters where id = :'npc') = 0, 'player cannot see hidden NPC');
select t_ok((select count(*) from sheet_blocks where character_id = :'npc') = 0, 'player cannot see hidden NPC blocks');
select t_ok((select count(*) from scenes where id = :'prep') = 0, 'player cannot see prep scene');
select t_ok((select count(*) from scene_zones where scene_id = :'prep') = 0, 'player cannot see prep zones');
select t_ok((select count(*) from scene_aspects where scene_id = :'prep') = 0, 'player cannot see prep aspects');
select t_ok((select count(*) from scene_tokens where scene_id = :'prep') = 0, 'player cannot see prep tokens');
select t_ok((select count(*) from rolls where id = :'hidden_roll') = 0, 'player cannot see closed GM roll');
select t_ok((select count(*) from session_events where kind = 'hidden_roll' and payload->>'roll_id' = :'hidden_roll') = 1, 'player sees hidden_roll event');
select t_ok((select payload ? 'total' or payload ? 'faces' from session_events where kind = 'hidden_roll') = false, 'hidden_roll event has no result');
select t_ok((select spotlight->>'text' from sessions where id = :'sa') = 'Knight Errant', 'player sees spotlight');
select t_err($$select public.reveal_roll('$$ || :'hidden_roll' || $$')$$, 'not_gm', 'player cannot reveal');
select t_ok(public.claim_gm('nope not the code') is null, 'claim_gm unknown code returns null');
select t_ok((select role from session_members where user_id = auth.uid() and session_id = :'sa') = 'player', 'failed claim grants nothing');
reset role;

-- GM: reveal, share NPC + scene
select set_config('request.jwt.claims', :GM, false); set role authenticated;
select (public.reveal_roll(:'hidden_roll')).is_hidden = false as revealed;
update characters set visible_to_players = true where id = :'npc';
update sessions set active_scene_id = :'prep' where id = :'sa';
insert into scene_aspects(scene_id, text) values (:'prep', 'Fog');
select t_ok((select count(*) from session_events where kind = 'scene_aspect_added' and payload->>'text' = 'Fog') = 1, 'aspect in active scene emits toast event');
select t_ok(public.claim_gm('EMBER LANTERN OTTER QUARRY') = :'sa', 'GM reclaims with differently-cased code');
reset role;

select set_config('request.jwt.claims', :A1, false); set role authenticated;
select t_ok((select count(*) from rolls where id = :'hidden_roll') = 1, 'player sees roll after reveal');
select t_ok((select count(*) from characters where id = :'npc') = 1, 'player sees NPC once visible');
select t_ok((select count(*) from sheet_blocks where character_id = :'npc') = 1, 'player sees visible NPC blocks');
select t_ok(t_rows($$update public.characters set name='x' where id = '$$ || :'npc' || $$'$$) = 0, 'player still cannot edit visible NPC');
select t_ok((select count(*) from scene_zones where scene_id = :'prep') = 1, 'player sees zones of active scene');
select t_ok((select count(*) from scene_tokens where scene_id = :'prep') = 1, 'player sees tokens of active scene');
select t_ok(t_rows($$update public.scene_tokens set x = 0 where scene_id = '$$ || :'prep' || $$'$$) = 0, 'player cannot move tokens');
select t_ok(t_rows($$delete from public.scene_zones where scene_id = '$$ || :'prep' || $$'$$) = 0, 'player cannot delete zones');
select t_ok((select count(*) from session_events where kind = 'visibility_changed') >= 2, 'visibility_changed events emitted');
-- rate limit: 9 more failures (1 already), then 11th raises
select count(public.claim_gm('wrong code number ' || g)) from generate_series(1, 9) g;
select t_err($$select public.claim_gm('wrong code number 99')$$, 'rate_limited', '11th failure is rate limited');
reset role;
-- GM-made templates (0006)
select set_config('request.jwt.claims', :A1, false); set role authenticated;
select t_err($$select public.create_character('$$ || :'sa' || $$', '{"kind":"template","name":"x","sections":[],"blocks":[]}')$$, 'not_gm', 'player cannot create a template');
reset role;
select set_config('request.jwt.claims', :GM, false); set role authenticated;
select public.create_character(:'sa', '{"kind":"template","name":"Silver Order Knight","template":"core",
  "sections":[{"id":"s_aspects","title":"Aspects"},{"id":"s_skills","title":"Skills"}],
  "blocks":[{"id":"b_tpla000001","type":"aspect","label":"Oath","value":"","section":"s_aspects"},
            {"id":"b_tpls000001","type":"skill","label":"Fight","value":2,"section":"s_skills"}]}'::jsonb) as tpl \gset
select t_ok((select kind from characters where id = :'tpl') = 'template', 'GM creates a template');
select t_err($$select public.roll_dice('$$ || :'sa' || $$', '$$ || :'tpl' || $$', 'b_tpls000001')$$, 'not_allowed', 'templates cannot be rolled');
reset role;
select set_config('request.jwt.claims', :A1, false); set role authenticated;
select t_ok((select count(*) from characters where id = :'tpl') = 0, 'player cannot see a draft template');
select t_ok((select count(*) from sheet_blocks where character_id = :'tpl') = 0, 'player cannot see draft template blocks');
reset role;
select set_config('request.jwt.claims', :GM, false); set role authenticated;
update characters set visible_to_players = true where id = :'tpl';
reset role;
select set_config('request.jwt.claims', :A1, false); set role authenticated;
select t_ok((select count(*) from sheet_blocks where character_id = :'tpl') = 2, 'player can read an offered template');
select t_ok(t_rows($$update public.sheet_blocks set label = 'x' where character_id = '$$ || :'tpl' || $$'$$) = 0, 'player cannot edit an offered template');
select t_ok(t_rows($$delete from public.characters where id = '$$ || :'tpl' || $$'$$) = 0, 'player cannot delete an offered template');
reset role;
select set_config('request.jwt.claims', :B, false); set role authenticated;
select t_ok((select count(*) from characters where id = :'tpl') = 0, 'other session cannot see the template');
reset role;

-- Deleting characters and sessions
select set_config('request.jwt.claims', :A2, false); set role authenticated;
select t_ok(t_rows($$delete from public.characters where id = '$$ || :'c1' || $$'$$) = 0, 'a player cannot delete another player''s character');
select t_ok(t_rows($$delete from public.sessions where id = '$$ || :'sa' || $$'$$) = 0, 'a player cannot delete the session');
reset role;
select set_config('request.jwt.claims', :GM, false); set role authenticated;
select t_ok(t_rows($$delete from public.characters where id = '$$ || :'npc' || $$'$$) = 1, 'GM deletes a character (NPC)');
reset role;
select t_ok((select count(*) from sheet_blocks where character_id = :'npc') = 0, 'deleting a character deletes its sheet');
select t_ok((select count(*) from scene_tokens where character_id is null and label = 'Thug') >= 1 and (select count(*) from scene_tokens where character_id = :'npc') = 0, 'its board tokens stay as plain markers');
select count(*) > 0 as had_rows from rolls where session_id = :'sa' \gset
select set_config('request.jwt.claims', :GM, false); set role authenticated;
select t_ok(t_rows($$delete from public.sessions where id = '$$ || :'sa' || $$'$$) = 1, 'GM deletes the session');
reset role;
select t_ok(
  (select count(*) from sessions where id = :'sa') + (select count(*) from session_secrets where session_id = :'sa')
  + (select count(*) from session_members where session_id = :'sa') + (select count(*) from characters where session_id = :'sa')
  + (select count(*) from sheet_sections where session_id = :'sa') + (select count(*) from sheet_blocks where session_id = :'sa')
  + (select count(*) from rolls where session_id = :'sa') + (select count(*) from scenes where session_id = :'sa')
  + (select count(*) from scene_zones where session_id = :'sa') + (select count(*) from scene_aspects where session_id = :'sa')
  + (select count(*) from scene_tokens where session_id = :'sa') + (select count(*) from session_events where session_id = :'sa') = 0,
  'session delete removes every row of that session from every table');
select t_ok((select count(*) from sessions where id = :'sb') = 1, 'other sessions are untouched');
select set_config('request.jwt.claims', :GM, false); set role authenticated;
select t_ok((public.create_session('ember lantern otter quarry', 'Again', 'Sam')) ->> 'session_id' is not null, 'the freed GM code can start a new session');
reset role;

select 'ALL DONE' as result;
