import { createClient, type SupabaseClient } from '@supabase/supabase-js'

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
    if (existing.session) return existing.session.user.id
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
