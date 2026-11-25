// Invite codes: 6 characters from an alphabet without 0/O/1/I (SPEC §3.2).

const INVITE_RE = /^[A-HJ-NP-Z2-9]{6}$/

/** Upper-case and strip anything that isn't a letter or digit. */
export function normalizeInviteCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function isValidInviteCode(code: string): boolean {
  return INVITE_RE.test(code)
}

/** Accepts a bare code ("k7q pmx") or a pasted invite link (".../join/K7QPMX"). */
export function extractInviteCode(input: string): string {
  const fromUrl = input.match(/\/join\/([A-Za-z0-9-]+)/)
  return normalizeInviteCode(fromUrl ? fromUrl[1] : input)
}

export function inviteUrl(code: string, origin = window.location.origin): string {
  return `${origin}/join/${code}`
}
