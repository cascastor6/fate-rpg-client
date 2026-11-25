import { describe, expect, it } from 'vitest'
import { friendlyError, isNetworkError, OUTDATED_DB } from './errors.ts'

describe('friendlyError', () => {
  it('maps our RPC error codes', () => {
    expect(friendlyError({ code: 'P0001', message: 'not_gm' })).toBe('Only the GM can do that.')
    expect(friendlyError({ message: 'weak_gm_code' })).toMatch(/too easy/)
  })
  it('says the database needs updating when a migration is missing', () => {
    expect(friendlyError({ code: 'PGRST202', message: 'Could not find the function public.session_preview(p_invite_code) in the schema cache' })).toBe(OUTDATED_DB)
    expect(friendlyError({ code: '42703', message: 'column "kind" does not exist' })).toBe(OUTDATED_DB)
  })
  it('makes Postgres errors readable', () => {
    expect(friendlyError({ code: '42501', message: 'new row violates row-level security policy for table "scenes"' })).toBe('You don’t have permission to do that.')
    expect(friendlyError({ code: '23505', message: 'duplicate key value violates unique constraint' })).toBe('That already exists.')
    expect(friendlyError({ message: 'TypeError: Failed to fetch' })).toMatch(/Can’t reach the server/)
    expect(friendlyError(null)).toBe('Something went wrong.')
  })
  it('tells network errors from server errors', () => {
    expect(isNetworkError({ message: 'TypeError: Failed to fetch' })).toBe(true)
    expect(isNetworkError({ code: '42501', message: 'Failed to fetch' })).toBe(false)
  })
})
