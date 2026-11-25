-- Fate Table: what the join page may know before joining (SPEC §3.3, §7.8).
-- Anyone holding the invite code can join anyway, so revealing the session name and
-- the colours already in use to them leaks nothing new.

create or replace function public.session_preview(p_invite_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_code text := upper(regexp_replace(coalesce(p_invite_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_sid  uuid;
  v_name text;
begin
  perform private.require_uid();
  select s.id, s.name into v_sid, v_name from public.sessions s where s.invite_code = v_code;
  if v_sid is null then perform private.fail('invalid_invite'); end if;
  return jsonb_build_object(
    'name', v_name,
    'taken_colors', coalesce((select jsonb_agg(m.color order by m.joined_at)
                              from public.session_members m where m.session_id = v_sid), '[]'::jsonb),
    'already_member', exists (select 1 from public.session_members m
                              where m.session_id = v_sid and m.user_id = auth.uid()));
end $$;

revoke execute on function public.session_preview(text) from public, anon;
grant execute on function public.session_preview(text) to authenticated;
