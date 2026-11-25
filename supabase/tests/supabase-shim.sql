-- Minimal stand-in for the Supabase pieces the migrations use (auth.uid, roles, vault, realtime publication).
-- Used only by scripts/rls-test-local.sh.
-- Minimal stand-in for the parts of Supabase the migrations use.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema auth; create schema extensions; create schema vault;
grant usage on schema auth, extensions to anon, authenticated;
grant usage on schema public to anon, authenticated;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text, description text);
create view vault.decrypted_secrets as select id, name, secret as decrypted_secret, description from vault.secrets;
create function vault.create_secret(new_secret text, new_name text, new_description text) returns uuid language sql as $$
  insert into vault.secrets(name, secret, description) values (new_name, new_secret, new_description) returning id $$;
create publication supabase_realtime;
-- Supabase-style permissive defaults, to prove the migrations revoke them.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
