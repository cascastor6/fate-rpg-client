-- Fate Table: realtime publication and the GM-code pepper.

-- Realtime: postgres_changes applies RLS per subscriber, so clients only get rows they can select.
-- (DELETE events can't be filtered or RLS-checked; they carry only primary keys. See SPEC §10.)
alter publication supabase_realtime add table
  public.sessions,
  public.session_members,
  public.characters,
  public.sheet_sections,
  public.sheet_blocks,
  public.rolls,
  public.scenes,
  public.scene_zones,
  public.scene_aspects,
  public.scene_tokens,
  public.session_events;

-- Pepper for GM-code hashes, kept in Supabase Vault (never in a table). Created once.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'gm_code_pepper') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'gm_code_pepper',
      'HMAC pepper for Fate Table GM codes. Changing it invalidates every GM code.');
  end if;
end $$;
