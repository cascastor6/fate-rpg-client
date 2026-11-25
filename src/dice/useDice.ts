import { useEffect, useState, useSyncExternalStore } from 'react'
import { useSession } from '../session/SessionProvider.tsx'
import { getDiceStore } from './store.ts'

export function useDice() {
  const { session } = useSession()
  const store = getDiceStore(session.id)
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot)
  return { store, ...snap }
}

/** navigator.onLine, kept up to date. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}
