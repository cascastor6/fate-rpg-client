/** Error codes raised by the database RPCs (SPEC §4.4), mapped to plain language. */
const MESSAGES: Record<string, string> = {
  not_authenticated: 'You are not signed in. Reload the page and try again.',
  not_member: 'You are not part of this session.',
  not_gm: 'Only the GM can do that.',
  not_allowed: 'You can’t change that.',
  not_found: 'That no longer exists.',
  invalid_input: 'Something in that form isn’t valid.',
  invalid_invite: 'No session with that code.',
  weak_gm_code: 'That GM code is too easy to guess. Use at least 10 characters, or tap “Suggest one”.',
  gm_code_taken: 'That GM code is already in use. Pick another.',
  rate_limited: 'Too many attempts. Try again in a few minutes.',
  invalid_spotlight: 'That can’t be highlighted.',
  block_not_found: 'That part of the sheet no longer exists.',
  invalid_block: 'That value isn’t valid for this block.',
  section_not_empty: 'Move or delete the blocks in this section first.',
  invalid_scene: 'That doesn’t belong to this scene.',
  sheet_limit: 'This sheet has reached its size limit.',
  server_misconfigured: 'The server isn’t set up correctly (GM code secret missing). See the README.',
}

/** Turn a Supabase/PostgREST error (or anything thrown) into a message for people. */
export function friendlyError(err: unknown): string {
  const message = typeof err === 'object' && err !== null && 'message' in err ? String(err.message) : String(err)
  if (message in MESSAGES) return MESSAGES[message]
  if (/failed to fetch|network/i.test(message)) return 'Can’t reach the server. Check your connection.'
  return message || 'Something went wrong.'
}

export function errorCode(err: unknown): string | null {
  const message = typeof err === 'object' && err !== null && 'message' in err ? String(err.message) : ''
  return message in MESSAGES ? message : null
}

/** True when the request never reached the server (offline, DNS, CORS, timeout). */
export function isNetworkError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const e = err as { message?: string; code?: string; status?: number }
  if (e.code && /^[0-9A-Z]{5}$|^PGRST/.test(e.code)) return false // a real database/API error
  return /failed to fetch|networkerror|load failed|network request failed|timeout|fetch failed/i.test(e.message ?? '')
}
