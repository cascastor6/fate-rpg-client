// localStorage can throw (private mode, blocked storage), so every access is guarded.

export function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable: the app still works, it just won't remember */
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

/** The session this device was last in, so reopening the app goes straight back (SPEC §3.3). */
export type LastSession = {
  sessionId: string
  sessionName: string
  inviteCode: string
  role: 'gm' | 'player'
  displayName: string
}

const LAST_KEY = 'fate.last'

export const getLastSession = () => readJson<LastSession>(LAST_KEY)
export const setLastSession = (s: LastSession) => writeJson(LAST_KEY, s)
export function clearLastSession(sessionId?: string) {
  if (!sessionId || getLastSession()?.sessionId === sessionId) removeKey(LAST_KEY)
}
