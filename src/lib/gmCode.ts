// GM code rules (SPEC §3.2). Mirrors private.normalize_gm_code / private.gm_code_is_strong
// in supabase/migrations/0003_rpcs.sql; gmCode.test.ts checks the two stay in sync.

import { WORDS } from './wordlist.ts'

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

export const GM_CODE_PROBLEM_TEXT: Record<GmCodeProblem, string> = {
  too_short: `Use at least ${GM_CODE_MIN_LENGTH} characters. A few words work well.`,
  repeated: 'That’s one character repeated. Pick something less guessable.',
  too_common: 'That one is too common. Pick something only you would think of.',
}

/** Uniform random integer in [0, n) for n a power of two up to 65536 (no modulo bias). */
function randomBelow(n: number, rand: (buf: Uint16Array<ArrayBuffer>) => void): number {
  const buf = new Uint16Array(1)
  rand(buf)
  return buf[0] % n
}

/** Four random words, e.g. "ember-lantern-otter-quarry" (~36 bits from a 512-word list). */
export function suggestGmCode(
  rand: (buf: Uint16Array<ArrayBuffer>) => void = (buf) => crypto.getRandomValues(buf),
): string {
  const words: string[] = []
  while (words.length < 4) {
    const w = WORDS[randomBelow(WORDS.length, rand)]
    if (!words.includes(w)) words.push(w)
  }
  return words.join('-')
}
