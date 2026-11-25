import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { firstUnusedColor, PALETTE } from './colors.ts'

describe('colors', () => {
  it('picks the first unused colour', () => {
    expect(firstUnusedColor([])).toBe('red')
    expect(firstUnusedColor(['red', 'orange'])).toBe('amber')
    expect(firstUnusedColor([...PALETTE])).toBe('slate')
  })
  it('matches the database palette', () => {
    const sql = readFileSync(new URL('../../supabase/migrations/0001_schema.sql', import.meta.url), 'utf8')
    const fn = sql.slice(sql.indexOf('function private.palette()'))
    const start = fn.indexOf('array[') + 6
    const list = fn.slice(start, fn.indexOf(']', start))
    expect([...list.matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual([...PALETTE])
  })
})
