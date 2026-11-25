import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GM_CODE_BLOCKLIST, gmCodeProblem, normalizeGmCode, suggestGmCode } from './gmCode.ts'
import { WORDS } from './wordlist.ts'

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

describe('suggestGmCode', () => {
  it('gives four distinct words from the list that pass the strength rule', () => {
    for (let i = 0; i < 200; i++) {
      const code = suggestGmCode()
      const words = code.split('-')
      expect(words).toHaveLength(4)
      expect(new Set(words).size).toBe(4)
      for (const w of words) expect(WORDS).toContain(w)
      expect(gmCodeProblem(code)).toBeNull()
    }
  })
  it('uses the injected random source', () => {
    let n = 0
    const code = suggestGmCode((buf) => { buf[0] = n++ })
    expect(code).toBe(WORDS.slice(0, 4).join('-'))
  })
  it('has 512 unique lowercase words', () => {
    expect(WORDS).toHaveLength(512)
    expect(new Set(WORDS).size).toBe(512)
    for (const w of WORDS) expect(w).toMatch(/^[a-z]{3,8}$/)
  })
})
