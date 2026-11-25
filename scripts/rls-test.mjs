#!/usr/bin/env node
// RLS test against a real Supabase project (SPEC §13).
//
//   npm run test:rls
//
// Reads VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from the environment
// (npm run test:rls loads .env.local automatically). Requires anonymous
// sign-ins to be enabled. Signs in 5 anonymous users, builds two sessions,
// checks every access rule, then deletes both sessions.
//
// Note: Supabase rate-limits anonymous sign-ins per IP (30/hour by default),
// so running this more than ~6 times an hour can fail at sign-in.

import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'

const url = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_ANON_KEY
if (!url || !key) {
  console.error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (e.g. in .env.local).')
  process.exit(2)
}

let passed = 0
let failed = 0
const pass = (msg) => { passed++; console.log(`  PASS  ${msg}`) }
const fail = (msg, detail) => { failed++; console.log(`  FAIL  ${msg}${detail ? `  -> ${detail}` : ''}`) }
const check = (cond, msg, detail) => (cond ? pass(msg) : fail(msg, detail))
const section = (title) => console.log(`\n${title}`)

/** Expect a supabase-js result to be an error (optionally matching a pattern). */
function expectError(res, msg, pattern) {
  if (!res.error) return fail(msg, `no error, data=${JSON.stringify(res.data)}`)
  const text = `${res.error.code ?? ''} ${res.error.message ?? ''}`
  if (pattern && !pattern.test(text)) return fail(msg, `wrong error: ${text}`)
  pass(`${msg}  (${res.error.message})`)
}
/** Expect a select/update/delete to succeed but touch zero rows. */
function expectNoRows(res, msg) {
  if (res.error) return pass(`${msg}  (error: ${res.error.message})`)
  const n = Array.isArray(res.data) ? res.data.length : res.data ? 1 : 0
  check(n === 0, msg, `${n} row(s) returned`)
}
function expectRows(res, n, msg) {
  if (res.error) return fail(msg, res.error.message)
  const got = Array.isArray(res.data) ? res.data.length : res.data ? 1 : 0
  check(got === n, msg, `expected ${n}, got ${got}`)
}

async function user(name) {
  const c = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await c.auth.signInAnonymously()
  if (error) {
    console.error(`Anonymous sign-in failed for ${name}: ${error.message}`)
    console.error('Is "Allow anonymous sign-ins" enabled in Authentication settings?')
    process.exit(2)
  }
  c.uid = data.user.id
  return c
}

const words = () => randomBytes(12).toString('hex').match(/.{4}/g).join(' ')
const sheet = {
  kind: 'pc', name: 'Aldric', template: 'core',
  sections: [{ id: 's_aspects', title: 'Aspects' }, { id: 's_skills', title: 'Skills' }, { id: 's_stress', title: 'Stress' }],
  blocks: [
    { id: 'b_hc00000001', type: 'aspect', label: 'High Concept', value: 'Disgraced Knight', section: 's_aspects', role: 'high_concept' },
    { id: 'b_fight00001', type: 'skill', label: 'Fight', value: 3, section: 's_skills', rollable: true },
    { id: 'b_phys000001', type: 'stress', label: 'Physical', section: 's_stress', value: [{ size: 1, checked: false }, { size: 2, checked: false }] },
  ],
}

const gm = await user('GM A')
const a1 = await user('Player A1')
const a2 = await user('Player A2')
const gb = await user('GM B')
const b = await user('Player B')
const anon = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

let sa, sb
try {
  section('Setup and GM codes')
  const codeA = words()
  const r1 = await gm.rpc('create_session', { p_gm_code: codeA, p_name: 'RLS test A', p_display_name: 'Sam', p_color: 'red' })
  if (r1.error) throw new Error(`create_session failed: ${r1.error.message}. Did you run the migrations?`)
  sa = r1.data.session_id
  const invA = r1.data.invite_code
  pass('GM A created session A')
  expectError(await gm.rpc('create_session', { p_gm_code: 'short', p_name: 'x', p_display_name: 'x' }), 'weak GM code rejected', /weak_gm_code/)
  expectError(await gm.rpc('create_session', { p_gm_code: codeA.toUpperCase().replaceAll(' ', '-'), p_name: 'x', p_display_name: 'x' }),
    'already-used GM code (other spelling) rejected', /gm_code_taken/)
  const r2 = await gb.rpc('create_session', { p_gm_code: words(), p_name: 'RLS test B', p_display_name: 'Bo' })
  sb = r2.data.session_id
  const j = await b.rpc('join_session', { p_invite_code: r2.data.invite_code, p_display_name: 'Bea B' })
  check(!j.error, 'player B joined session B', j.error?.message)

  expectError(await anon.from('sessions').select('*'), 'signed-out client cannot read sessions')

  section('Joining and sheets')
  expectError(await a1.rpc('join_session', { p_invite_code: 'ZZZZZZ', p_display_name: 'Al' }), 'unknown invite rejected', /invalid_invite/)
  const ja1 = await a1.rpc('join_session', { p_invite_code: invA.toLowerCase(), p_display_name: 'Al' })
  check(ja1.data === sa, 'A1 joined A (invite is case-insensitive)', ja1.error?.message)
  await a2.rpc('join_session', { p_invite_code: invA, p_display_name: 'Ann' })
  const cc = await a1.rpc('create_character', { p_session_id: sa, p_sheet: sheet })
  check(!cc.error, 'A1 created a character', cc.error?.message)
  const c1 = cc.data
  expectError(await a1.rpc('create_character', { p_session_id: sa, p_sheet: { kind: 'npc', name: 'x', sections: [], blocks: [] } }),
    'player cannot create an NPC', /not_gm/)
  const own = await a1.rpc('patch_block', { p_character_id: c1, p_block_id: 'b_hc00000001', p_patch: { value: 'Knight Errant' } })
  check(own.data?.value === 'Knight Errant', 'A1 edits own block', own.error?.message)

  section('Player A2 vs A1\'s sheet')
  expectRows(await a2.from('sheet_blocks').select('id').eq('character_id', c1), 3, 'A2 can READ A1\'s blocks')
  expectNoRows(await a2.from('characters').update({ name: 'Hacked' }).eq('id', c1).select(), 'A2 cannot update A1\'s character')
  expectNoRows(await a2.from('characters').delete().eq('id', c1).select(), 'A2 cannot delete A1\'s character')
  expectNoRows(await a2.from('sheet_blocks').update({ label: 'x' }).eq('character_id', c1).select(), 'A2 cannot update A1\'s blocks')
  expectNoRows(await a2.from('sheet_blocks').delete().eq('character_id', c1).select(), 'A2 cannot delete A1\'s blocks')
  expectNoRows(await a2.from('sheet_sections').update({ title: 'x' }).eq('character_id', c1).select(), 'A2 cannot update A1\'s sections')
  expectError(await a2.rpc('patch_block', { p_character_id: c1, p_block_id: 'b_hc00000001', p_patch: { value: 'pwned' } }),
    'A2 patch_block on A1 refused', /block_not_found/)
  expectError(await a2.rpc('set_stress_box', { p_character_id: c1, p_block_id: 'b_phys000001', p_index: 0, p_checked: true }),
    'A2 set_stress_box on A1 refused', /block_not_found/)
  expectError(await a2.rpc('adjust_fate_points', { p_character_id: c1, p_delta: 5 }), 'A2 adjust_fate_points on A1 refused', /not_allowed/)
  expectError(await a2.rpc('replace_sheet', { p_character_id: c1, p_sheet: { sections: [], blocks: [] } }), 'A2 replace_sheet on A1 refused', /not_allowed/)
  expectError(await a2.from('sheet_blocks').insert({ character_id: c1, id: 'b_evil000001', section_id: 's_skills', type: 'skill', label: 'x', value: 1, position: 9 }),
    'A2 cannot insert into A1\'s sheet')

  section('Locked-down tables')
  expectError(await a2.from('rolls').insert({ session_id: sa, roller_name: 'x', roller_color: 'red', faces: [1, 1, 1, 1], dice_total: 4, total: 4 }),
    'player cannot insert rolls directly')
  expectError(await a2.from('session_secrets').select('*'), 'player cannot read session_secrets')
  expectNoRows(await a2.from('sessions').update({ name: 'mine' }).eq('id', sa).select(), 'player cannot update the session')
  expectError(await a2.from('sessions').update({ spotlight: {} }).eq('id', sa), 'player cannot write spotlight directly')
  expectNoRows(await a2.from('sessions').update({ active_scene_id: null }).eq('id', sa).select(), 'player cannot change the active scene')
  expectNoRows(await a2.from('sessions').update({ gm_roll_mode: 'closed' }).eq('id', sa).select(), 'player cannot change gm_roll_mode')
  expectRows(await a2.from('session_members').update({ color: 'pink' }).eq('user_id', a2.uid).select(), 1, 'player can change own colour')
  expectNoRows(await a2.from('session_members').update({ color: 'pink' }).eq('user_id', a1.uid).select(), 'player cannot change another member\'s colour')
  expectError(await a2.from('session_members').update({ role: 'gm' }).eq('user_id', a2.uid), 'player cannot promote themselves')
  expectError(await a2.rpc('roll_dice', { p_session_id: sa, p_hidden: true }), 'player hidden roll refused', /not_gm/)
  expectError(await a2.rpc('set_spotlight', { p_session_id: sa, p_character_id: c1, p_block_id: 'b_hc00000001' }), 'player set_spotlight refused', /not_gm/)
  expectError(await a2.from('scenes').insert({ session_id: sa, name: 'evil' }), 'player cannot create scenes')

  section('Player B (other session) sees nothing of session A')
  for (const t of ['sessions', 'session_members', 'characters', 'sheet_sections', 'sheet_blocks', 'rolls',
    'scenes', 'scene_zones', 'scene_aspects', 'scene_tokens', 'session_events']) {
    const col = t === 'sessions' ? 'id' : 'session_id'
    expectNoRows(await b.from(t).select('*').eq(col, sa), `B cannot read ${t} of A`)
  }
  expectError(await b.rpc('roll_dice', { p_session_id: sa }), 'B cannot roll in A', /not_member/)

  section('GM A')
  expectNoRows(await gm.from('sessions').select('*').eq('id', sb), 'GM A cannot read session B')
  const ge = await gm.rpc('patch_block', { p_character_id: c1, p_block_id: 'b_hc00000001', p_patch: { label: 'HC' } })
  check(ge.data?.label === 'HC', 'GM edits A1\'s block', ge.error?.message)
  const fp = await gm.rpc('adjust_fate_points', { p_character_id: c1, p_delta: 1 })
  check(fp.data === 4, 'GM awards A1 a fate point', fp.error?.message)
  const pool = await gm.from('sessions').select('gm_fate_points').eq('id', sa).single()
  check(pool.data?.gm_fate_points === 0, 'award does not touch the GM pool')
  expectError(await gm.rpc('set_spotlight', { p_session_id: sb, p_character_id: c1, p_block_id: 'b_hc00000001' }),
    'GM A cannot spotlight in session B', /not_gm/)

  const npc = (await gm.rpc('create_character', { p_session_id: sa, p_sheet: {
    kind: 'npc', name: 'Thug', template: 'npc', sections: [{ id: 's_aspects', title: 'Aspects' }],
    blocks: [{ id: 'b_npca000001', type: 'aspect', label: 'Aspect', value: 'Hired Muscle', section: 's_aspects' }] } })).data
  const prep = (await gm.from('scenes').insert({ session_id: sa, name: 'Docks (prep)', kind: 'zones' }).select().single()).data
  const zone = (await gm.from('scene_zones').insert({ scene_id: prep.id, title: 'Pier', x: 100, y: 100 }).select().single()).data
  const zasp = (await gm.from('scene_aspects').insert({ scene_id: prep.id, zone_id: zone.id, text: 'Slippery Planks' }).select().single()).data
  await gm.from('scene_tokens').insert({ scene_id: prep.id, character_id: npc, label: 'Thug', x: 200, y: 150 })
  expectError(await gm.rpc('set_spotlight', { p_session_id: sa, p_scene_aspect_id: zasp.id }),
    'cannot spotlight an aspect of a non-active scene', /invalid_spotlight/)
  await gm.from('sessions').update({ gm_roll_mode: 'closed' }).eq('id', sa)
  const hidden = (await gm.rpc('roll_dice', { p_session_id: sa })).data
  check(hidden?.is_hidden === true, 'GM roll is hidden when mode is closed')

  section('Hidden things stay hidden from players')
  expectNoRows(await a1.from('characters').select('*').eq('id', npc), 'player cannot see a hidden NPC')
  expectNoRows(await a1.from('sheet_blocks').select('*').eq('character_id', npc), 'player cannot see a hidden NPC\'s blocks')
  expectNoRows(await a1.from('scenes').select('*').eq('id', prep.id), 'player cannot see a prep scene')
  expectNoRows(await a1.from('scene_zones').select('*').eq('scene_id', prep.id), 'player cannot see prep zones')
  expectNoRows(await a1.from('scene_tokens').select('*').eq('scene_id', prep.id), 'player cannot see prep tokens')
  expectNoRows(await a1.from('rolls').select('*').eq('id', hidden.id), 'player cannot see a closed GM roll')
  expectRows(await a1.from('session_events').select('payload').eq('kind', 'hidden_roll').eq('payload->>roll_id', hidden.id), 1,
    'player sees the hidden_roll event (no result inside)')
  expectError(await a1.rpc('reveal_roll', { p_roll_id: hidden.id }), 'player cannot reveal a roll', /not_gm/)
  const cl = await a1.rpc('claim_gm', { p_gm_code: 'definitely not the code' })
  check(cl.data === null && !cl.error, 'claim_gm with an unknown code returns null')

  section('After the GM shares')
  await gm.rpc('reveal_roll', { p_roll_id: hidden.id })
  await gm.from('characters').update({ visible_to_players: true }).eq('id', npc)
  await gm.from('sessions').update({ active_scene_id: prep.id }).eq('id', sa)
  expectRows(await a1.from('rolls').select('id').eq('id', hidden.id), 1, 'player sees the roll after reveal')
  expectRows(await a1.from('characters').select('id').eq('id', npc), 1, 'player sees the NPC once visible')
  expectNoRows(await a1.from('characters').update({ name: 'x' }).eq('id', npc).select(), 'player still cannot edit a visible NPC')
  expectRows(await a1.from('scene_zones').select('id').eq('scene_id', prep.id), 1, 'player sees zones of the active scene')
  expectNoRows(await a1.from('scene_tokens').update({ x: 0 }).eq('scene_id', prep.id).select(), 'player cannot move tokens')

  section('GM code rate limit')
  for (let i = 0; i < 9; i++) await a1.rpc('claim_gm', { p_gm_code: `wrong code number ${i}` })
  expectError(await a1.rpc('claim_gm', { p_gm_code: 'wrong code number 99' }), '11th failed claim in 10 minutes is rate limited', /rate_limited/)
} catch (e) {
  fail('test run aborted', e.message)
} finally {
  if (sa) await gm.from('sessions').delete().eq('id', sa)
  if (sb) await gb.from('sessions').delete().eq('id', sb)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
