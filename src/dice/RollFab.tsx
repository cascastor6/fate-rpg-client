import { useEffect, useRef } from 'react'
import { useSession } from '../session/SessionProvider.tsx'
import { useOverlayOpen } from '../ui/overlays.ts'
import { Spinner } from '../ui/primitives.tsx'
import { useDice, useOnline } from './useDice.ts'

const LONG_PRESS_MS = 500

/**
 * Floating 4dF button (SPEC §7.5): tap = plain roll, long-press = roll dialog, `R` = plain
 * roll. Hidden while a sheet/drawer is open; disabled offline or while a roll is in flight.
 */
export function RollFab() {
  const { isGm, session } = useSession()
  const { store, rolling, dialog } = useDice()
  const covered = useOverlayOpen()
  const online = useOnline()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressed = useRef(false)
  const closed = isGm && session.gm_roll_mode === 'closed'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'r' && e.key !== 'R') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return
      if (document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      void store.roll()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [store])

  if (covered || dialog) return null

  const start = () => {
    longPressed.current = false
    timer.current = setTimeout(() => {
      longPressed.current = true
      store.openDialog()
    }, LONG_PRESS_MS)
  }
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  return (
    <button
      type="button"
      aria-label={closed ? 'Roll 4dF (closed: only GMs see the result)' : 'Roll 4dF'}
      title={!online ? 'Offline' : 'Roll 4dF (long-press for options, or press R)'}
      disabled={!online || rolling}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => {
        if (longPressed.current) return
        void store.roll()
      }}
      className="fixed right-4 z-30 flex size-14 select-none items-center justify-center rounded-full bg-amber-700 text-white shadow-xl transition-transform hover:bg-amber-800 active:scale-95 disabled:bg-stone-400 dark:disabled:bg-stone-600"
      style={{ bottom: 'calc(var(--bar-h, 0px) + 16px + env(safe-area-inset-bottom))', touchAction: 'manipulation' }}
    >
      {rolling ? (
        <Spinner className="size-6" />
      ) : (
        <svg className="size-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="4" />
          <path d="M12 8v8M8 12h8" />
        </svg>
      )}
      {closed && (
        <span className="absolute -right-1 -top-1 flex size-6 items-center justify-center rounded-full bg-stone-900 text-[10px] font-bold text-white ring-2 ring-white" aria-hidden="true">
          <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A9.8 9.8 0 0 1 12 5c5 0 9 4.5 10 7a12.8 12.8 0 0 1-3 4.2M6.6 6.6C4.4 8 2.9 10 2 12c1 2.5 5 7 10 7a9.6 9.6 0 0 0 5.4-1.6" /></svg>
        </span>
      )}
    </button>
  )
}
