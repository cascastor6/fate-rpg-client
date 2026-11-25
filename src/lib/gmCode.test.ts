import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GM_CODE_BLOCKLIST, gmCodeProblem, normalizeGmCode } from './gmCode.ts'

describe('normalizeGmCode', () => {
  it('ignores case, spacing and separators', () => {
    expect(normalizeGmCode('  Ember  Lantern\tOtter Quarry ')).toBe('ember lantern otter quarry')
    expect(normalizeGmCode('ember-lantern_otter.quarry')).toBe('ember lantern otter quarry')
    expect(normalizeGmCode('EMBER--LANTERN')).toBe('ember lantern')
  })
})

describe('gmCodeProblem', () => {
  it('accepts a passphrase', () => {
    expect(gmCodeProblem('ember lantern otter quarry')).toBeNull()
  })
  it('rejects short codes (after normalising)', () => {
    expect(gmCodeProblem('short')).toBe('too_short')
    expect(gmCodeProblem('a - b - c - d')).toBe('too_short') // "a b c d" is 7
  })
  it('rejects one repeated character', () => {
    expect(gmCodeProblem('aaaa aaaa aaaa')).toBe('repeated')
  })
  it('rejects common codes regardless of spacing', () => {
    expect(gmCodeProblem('Password 123')).toBe('too_common')
    expect(gmCodeProblem('fate-core-rpg')).toBe('too_common')
  })
})

describe('parity with the SQL migration', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/0003_rpcs.sql', import.meta.url), 'utf8')
  it('uses the same blocklist', () => {
    const fn = sql.slice(sql.indexOf('function private.gm_code_is_strong'))
    const list = fn.slice(fn.indexOf('array[') + 6, fn.indexOf('])'))
    const words = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect(words).toEqual([...GM_CODE_BLOCKLIST])
  })
  it('uses the same minimum length and separator rule', () => {
    expect(sql).toContain('char_length(p_normalized) >= 10')
    expect(sql).toContain(`'[\\s._-]+'`)
  })
})
