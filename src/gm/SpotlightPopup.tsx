import { useEffect, useState } from 'react'
import { readJson, writeJson } from '../lib/storage.ts'
import { useSession } from '../session/SessionProvider.tsx'
import { colorOf } from '../ui/colors.ts'
import { useOverlayOpen } from '../ui/overlays.ts'
import { activeSpotlight, spotlightSubtitle } from './spotlight.ts'

const AUTO_CLOSE_MS = 8000
const dismissedKey = (sessionId: string) => `fate.spotlight.dismissed.${sessionId}`

/**
 * Player pop-up for the GM's highlight (SPEC §8.2): no scrolling, never steals focus,
 * waits for open sheets, closes on tap or after 8 s, and doesn't come back once dismissed.
 */
export function SpotlightPopup() {
  const { session, isGm, uid, members } = useSession()
  const covered = useOverlayOpen()
  const s = activeSpotlight(session.spotlight)
  const [dismissed, setDismissed] = useState<string | null>(() => readJson<string>(dismissedKey(session.id)))
  const show = !isGm && !!s && dismissed !== s.set_at && !covered

  const dismiss = () => {
    if (!s) return
    setDismissed(s.set_at)
    writeJson(dismissedKey(session.id), s.set_at)
  }

  useEffect(() => {
    if (!show || !s) return
    if (s.kind === 'block' && s.character_kind === 'pc' && s.owner_id === uid) navigator.vibrate?.([20, 30, 20])
    const t = setTimeout(dismiss, AUTO_CLOSE_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, s?.set_at])

  if (!show || !s) return null
  const gm = members.find((m) => m.user_id === s.by) ?? members.find((m) => m.role === 'gm')
  const c = colorOf(gm?.color)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={dismiss} role="presentation">
      <div
        role="alertdialog"
        aria-label="The GM highlights"
        aria-describedby="spotlight-text"
        className="flex w-full max-w-sm flex-col items-center gap-3 rounded-3xl border-4 bg-[color:var(--card)] px-6 py-7 text-center shadow-2xl"
        style={{ borderColor: c.fill, boxShadow: `0 0 0 6px ${c.fill}33, 0 25px 50px -12px rgba(0,0,0,.4)` }}
      >
        <p className="text-sm font-bold uppercase tracking-widest"><span style={{ color: c.fill }} aria-hidden="true">★ </span>The GM highlights</p>
        <p id="spotlight-text" className="text-2xl font-bold leading-snug">{s.text}</p>
        <p className="text-[color:var(--muted)]">
          {spotlightSubtitle(s, uid)}
          {s.free_invokes ? ` · ${s.free_invokes} free invoke${s.free_invokes === 1 ? '' : 's'}` : ''}
        </p>
        <button type="button" className="mt-2 min-h-11 rounded-xl px-6 font-semibold text-white" style={{ background: c.fill, color: c.ink }}>
          OK
        </button>
      </div>
    </div>
  )
}
