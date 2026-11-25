// GM code rules (SPEC §3.2). Mirrors private.normalize_gm_code / private.gm_code_is_strong
// in supabase/migrations/0003_rpcs.sql; gmCode.test.ts checks the two stay in sync.

export const GM_CODE_MIN_LENGTH = 10

export const GM_CODE_BLOCKLIST = [
  'password', 'password1', 'password12', 'password123', 'password1234',
  '1234567890', '12345678910', '0123456789', '9876543210', 'qwertyuiop', 'asdfghjkl',
  'abcdefghij', 'abcdefghijk', 'letmeinplease', 'iamthegm', 'gamemaster', 'gamemaster1',
  'fatecore', 'fatecorerpg', 'fateaccelerated', 'fatecondensed', 'dungeonmaster',
] as const

/** Lower-case, treat runs of whitespace / - _ . as one space, trim. */
export function normalizeGmCode(code: string): string {
  return code.toLowerCase().replace(/[\s._-]+/g, ' ').trim()
}

export type GmCodeProblem = 'too_short' | 'repeated' | 'too_common'

/** Why a (raw) GM code would be rejected, or null if it's acceptable. */
export function gmCodeProblem(code: string): GmCodeProblem | null {
  const norm = normalizeGmCode(code)
  const compact = norm.replaceAll(' ', '')
  if (norm.length < GM_CODE_MIN_LENGTH) return 'too_short'
  if (/^(.)\1*$/.test(compact)) return 'repeated'
  if ((GM_CODE_BLOCKLIST as readonly string[]).includes(compact)) return 'too_common'
  return null
}
