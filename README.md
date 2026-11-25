# Fate Table

A web app for running Fate RPG sessions (Fate Core, Fate Accelerated, Fate Condensed): block-based character sheets, server-decided 4dF dice with a synced animation, a live GM screen, and GM scenes/NPCs. Players use their phones; nobody needs an account.

- **What it does and how:** [SPEC.md](SPEC.md)
- **Build order and per-slice test steps:** [PLAN.md](PLAN.md)

Stack: Vite + React + TypeScript + Tailwind, Supabase (Postgres, anonymous auth, RLS, Realtime, RPCs), deployed on Vercel.

---

## 1. Create the Supabase project

1. Sign in at [supabase.com](https://supabase.com) and create a new project. Pick any name and region, and save the database password; the CLI asks for it.
2. Turn on anonymous sign-ins: **Authentication → Sign In / Providers → "Allow anonymous sign-ins"** → Save.
3. Find your keys under **Project Settings → API** (or **API Keys**):
   - **Project URL**, e.g. `https://abcd1234.supabase.co`
   - **anon / publishable key**: it's safe in the browser, because row-level security protects the data.
   - Do **not** use the `service_role` / secret key anywhere in this app.
4. Note the **project ref**: the `abcd1234` part of the URL.

## 2. Environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```
VITE_SUPABASE_URL=https://abcd1234.supabase.co
VITE_SUPABASE_ANON_KEY=<your anon or publishable key>
```

`.env.local` is git-ignored.

## 3. Install and run the migrations

```bash
npm install
```

The schema, RLS policies and RPCs live in `supabase/migrations/` (`0001_schema.sql`, `0002_rls.sql`, …). Apply them with the Supabase CLI, which is installed as a dev dependency:

```bash
npx supabase login
```

```bash
npx supabase link --project-ref abcd1234
```

`link` asks for the database password you set when creating the project. If you've lost it, reset it under Project Settings → Database.

```bash
npm run db:push
```

`db:push` runs `supabase db push --remote`, which applies to your linked project any migrations it doesn't have yet. Run it again whenever a slice adds a migration. (Without `--remote`, CLI v3 targets a local Docker database and fails with `connect ECONNREFUSED 127.0.0.1:54322`.)

**Without the CLI:** open **SQL Editor** in the dashboard and run the files in order, pasting each one and clicking Run. Only do this on a fresh project, and don't mix the two methods.

The migrations also:
- add the tables to the `supabase_realtime` publication, so live updates work;
- create a random secret named `gm_code_pepper` in **Supabase Vault**, used to hash GM codes. Don't delete or change it: that would invalidate every GM code.

## 4. Run the dev server

```bash
npm run dev
```

Open http://localhost:5173. The home page should say **"Connected as <id> (anonymous)"** and **Database: Ready**.

### Testing on your phone

```bash
npm run dev -- --host
```

Vite prints a `Network:` URL like `http://192.168.1.23:5173`. Open it on a phone on the same Wi-Fi.

Plain `http://` on your network is fine for layout and touch. Browsers only allow wake lock, shake-to-roll (motion sensors) and installing the app over HTTPS, so test those on a Vercel preview deploy (see below).

## 5. Tests

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run build
```

### RLS test (against your Supabase project)

```bash
npm run test:rls
```

It reads `.env.local`, signs in five anonymous users, builds two sessions, and checks every access rule:
- a player can't read another session;
- a player can read but can't edit another player's sheet;
- hidden NPCs, prep scenes and closed GM rolls stay hidden;
- GM codes are checked and rate-limited.

It prints PASS/FAIL per check and deletes its test sessions afterwards. The anonymous users it creates remain; you can delete them under Authentication → Users.

Supabase limits anonymous sign-ins to 30 per hour per IP by default, so don't run it more than about 6 times an hour.

### RLS test without Supabase (optional)

If you have Postgres 15+ and `psql` locally, the same checks run in plain SQL against a throwaway database. A small shim stands in for Supabase's auth and vault.

```bash
PGHOST=localhost PGUSER=postgres npm run test:rls:local
```

## Troubleshooting

- **"The database is out of date for this version of the app"**: a new migration hasn't been applied. Run `npm run db:push`, then reload.
- **Deleting users under Authentication → Users**: safe. A browser whose anonymous user was deleted gets a fresh sign-in automatically on its next load or action. It loses its old memberships (players rejoin with the invite link, GMs re-enter the GM code). Old builds showed a raw `…_user_id_fkey` error here.
- **Light / dark mode**: follows your device by default. Change it on the home page or in ☰ Menu → You.
- **Changes don't show up live in the other window.** Migration `0004_realtime.sql` adds the tables to the `supabase_realtime` publication. Check **Database → Publications → supabase_realtime** lists `sessions`, `session_members`, `characters`, `sheet_sections`, `sheet_blocks` (and the rest). Reloading always shows the latest data.
- **"Could not find the function … in the schema cache"** or **"Something in that form isn't valid"** right after pulling: a new migration hasn't been applied. Run `npm run db:push`.

## 6. Deploy to Vercel

1. Import the GitHub repo in Vercel. The framework preset is **Vite**: build `npm run build`, output `dist`.
2. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` under **Settings → Environment Variables** (Production and Preview).
3. Every push gets a preview URL; use it for HTTPS-only phone features.

`vercel.json` rewrites all paths to `index.html`, so deep links like `/join/K7QPMX` work.

## Project layout

```
src/                  React app (see SPEC.md §11)
supabase/migrations/  SQL schema, RLS, RPCs, realtime
supabase/tests/       plain-SQL RLS test + Supabase shim (used by test:rls:local)
scripts/              rls-test.mjs (against your project), rls-test-local.sh
```
