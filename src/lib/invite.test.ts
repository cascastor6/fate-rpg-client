import { describe, expect, it } from 'vitest'
import { extractInviteCode, inviteUrl, isValidInviteCode } from './invite.ts'

describe('invite codes', () => {
  it('extracts a code from text or a pasted link', () => {
    expect(extractInviteCode(' k7q pmx ')).toBe('K7QPMX')
    expect(extractInviteCode('https://fate.example/join/K7QPMX')).toBe('K7QPMX')
    expect(extractInviteCode('fate.example/join/k7qpmx?x=1')).toBe('K7QPMX')
  })
  it('validates the alphabet and length', () => {
    expect(isValidInviteCode('K7QPMX')).toBe(true)
    expect(isValidInviteCode('K7QPM')).toBe(false)
    expect(isValidInviteCode('K7QPM0')).toBe(false) // no zero
    expect(isValidInviteCode('IOIOIO')).toBe(false) // no I/O
  })
  it('builds the invite URL', () => {
    expect(inviteUrl('K7QPMX', 'https://fate.example')).toBe('https://fate.example/join/K7QPMX')
  })
})
