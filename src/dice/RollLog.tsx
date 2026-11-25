import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSession } from '../session/SessionProvider.tsx'
import { colorOf } from '../ui/colors.ts'
import { IconX } from '../ui/icons.tsx'
import { overlays } from '../ui/overlays.ts'
import { MiniDice } from './Dice3D.tsx'
import { relativeTime, rollBreakdown } from './format.ts'
import { useDice } from './useDice.ts'

/** Roll log (SPEC §7.6): right-hand drawer on desktop, bottom drawer on phones. */
export function RollLog() {
  const { store, logOpen, log } = useDice()
  const { isGm } = useSession()
  const [, tick] = useState(0)

  useEffect(() => {
    if (!logOpen) return
    overlays.opened()
    const t = setInterval(() => tick((n) => n + 1), 30_000)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && store.setLogOpen(false)
    document.addEventListener('keydown', onKey)
    return () => {
      overlays.closed()
      clearInterval(t)
      document.removeEventListener('keydown', onKey)
    }
  }, [logOpen, store])

  if (!logOpen) return null
  return createPortal(
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/30" onClick={() => store.setLogOpen(false)} aria-hidden="true" />
      <aside
        role="dialog"
        aria-label="Roll log"
        className="absolute inset-x-0 bottom-0 flex max-h-[75dvh] flex-col rounded-t-3xl bg-[color:var(--card)] shadow-2xl lg:inset-y-0 lg:left-auto lg:right-0 lg:max-h-none lg:w-[26rem] lg:rounded-none"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <header className="flex items-center gap-2 border-b border-[color:var(--border)] px-4 py-2">
          <h2 className="flex-1 text-lg font-semibold">Roll log</h2>
          <button type="button" className="flex size-11 items-center justify-center rounded-xl hover:bg-black/5 dark:hover:bg-white/10" onClick={() => store.setLogOpen(false)} aria-label="Close roll log">
            <IconX />
          </button>
        </header>
        <ol className="flex-1 overflow-y-auto px-2 py-2">
          {log.length === 0 && <li className="px-3 py-6 text-center text-[color:var(--muted)]">No rolls yet. Tap the die button to roll.</li>}
          {log.map((e) => {
            if (e.kind === 'hidden') {
              const c = colorOf(e.hidden.roller_color)
              return (
                <li key={e.hidden.id} className="flex flex-col gap-1 rounded-xl px-3 py-2">
                  <div className="flex items-baseline gap-2">
                    <span className="font-semibold"><span className="mr-1.5 inline-block size-2.5 rounded-full align-middle" style={{ background: c.fill }} aria-hidden="true" />{e.hidden.roller_name}</span>
                    <span className="ml-auto text-xs text-[color:var(--muted)]">{relativeTime(e.hidden.created_at)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MiniDice faces={[null, null, null, null]} color="slate" />
                    <span className="italic text-[color:var(--muted)]">GM rolled behind the screen</span>
                  </div>
                </li>
              )
            }
            const r = e.roll
            const c = colorOf(r.roller_color)
            return (
              <li key={r.id} className="flex flex-col gap-1 rounded-xl px-3 py-2">
                <div className="flex items-baseline gap-2">
                  <span className="font-semibold"><span className="mr-1.5 inline-block size-2.5 rounded-full align-middle" style={{ background: c.fill }} aria-hidden="true" />{r.roller_name}</span>
                  {r.is_hidden && <span className="rounded-full bg-stone-800 px-2 text-xs font-semibold text-white">Hidden</span>}
                  {r.revealed_at && <span className="rounded-full bg-amber-100 px-2 text-xs font-semibold text-amber-900 dark:bg-amber-900 dark:text-amber-100">Revealed</span>}
                  <span className="ml-auto text-xs text-[color:var(--muted)]">{relativeTime(r.created_at)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <MiniDice faces={r.faces} color={r.roller_color} />
                  <span className="font-medium">{rollBreakdown(r)}</span>
                  {isGm && r.is_hidden && (
                    <button
                      type="button"
                      className="ml-auto min-h-11 rounded-lg px-3 text-sm font-semibold text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950"
                      onClick={() => void store.reveal(r.id)}
                    >
                      Reveal
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      </aside>
    </div>,
    document.body,
  )
}
