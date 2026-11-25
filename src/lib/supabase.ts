import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { isNetworkError, isStaleUser } from './errors.ts'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/** True when the Supabase env vars are present (see .env.example). */
export const isConfigured = Boolean(url && anonKey)

/** The shared client. Only use it after checking `isConfigured`. */
export const supabase: SupabaseClient = createClient(
  url ?? 'http://localhost:54321',
  anonKey ?? 'missing-anon-key',
  { auth: { persistSession: true, autoRefreshToken: true } },
)

let pending: Promise<string> | null = null

/**
 * Make sure this browser has an anonymous Supabase user and return its id.
 * The auth session is persisted in localStorage, so the same id survives reloads.
 */
export function ensureAnonymousUser(): Promise<string> {
  pending ??= (async () => {
    const { data: existing } = await supabase.auth.getSession()
    if (existing.session) {
      // A saved sign-in can outlive its user (deleted in the dashboard, project reset).
      // The token still verifies, but writes then fail on foreign keys, so ask the server.
      const { data: check, error: checkError } = await supabase.auth.getUser()
      if (!checkError && check.user) return check.user.id
      if (checkError && isNetworkError(checkError)) return existing.session.user.id // offline: trust it for now
      await supabase.auth.signOut({ scope: 'local' }) // gone: forget it and start fresh
    }
    const { data, error } = await supabase.auth.signInAnonymously()
    if (error) throw error
    if (!data.user) throw new Error('Anonymous sign-in returned no user')
    return data.user.id
  })().catch((e: unknown) => {
    pending = null // allow a retry
    throw e
  })
  return pending
}

/** Drop this device's anonymous user and make a new one (used when the server says it's gone). */
export async function resetAnonymousUser(): Promise<string> {
  pending = null
  await supabase.auth.signOut({ scope: 'local' })
  return ensureAnonymousUser()
}

/**
 * Run a call that may hit a stale sign-in (see ensureAnonymousUser); if it does, replace
 * the anonymous user and try once more. Only for calls that don't depend on who we were.
 */
export async function withFreshUserRetry<T extends { error: unknown }>(call: () => PromiseLike<T>): Promise<T> {
  const first = await call()
  if (!first.error || !isStaleUser(first.error)) return first
  await resetAnonymousUser()
  return call()
}
