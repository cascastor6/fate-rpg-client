import { useEffect, useState } from 'react'
import { useSession } from '../session/SessionProvider.tsx'
import { colorOf } from '../ui/colors.ts'
import { DiceRow, LANDING_MS, reducedMotion } from './Dice3D.tsx'
import { rollBreakdown } from './format.ts'
import { useDice } from './useDice.ts'

const HOLD_MS = 2600

/**
 * Plays queued rolls one at a time for everyone in the session (SPEC §7.1–7.2): dice tumble
 * onto the server's faces, then the result shows. Tap to dismiss early.
 */
export function DiceTray() {
  const { uid } = useSession()
  const { queue, store } = useDice()
  const current = queue[0]
  const [landed, setLanded] = useState(false)

  useEffect(() => {
    if (!current) return
    setLanded(false)
    const mine = current.kind === 'roll' && current.roll.user_id === uid
    const land = setTimeout(() => {
      setLanded(true)
      if (current.kind === 'roll') navigator.vibrate?.([30, 40, 30])
    }, reducedMotion() ? 300 : LANDING_MS)
    // With a backlog, don't make people wait through every result.
    const hold = queue.length > 2 ? 900 : HOLD_MS
    const done = setTimeout(() => store.finished(current.key, mine), (reducedMotion() ? 300 : LANDING_MS) + hold)
    return () => {
      clearTimeout(land)
      clearTimeout(done)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.key])

  if (!current) return null
  const color = current.kind === 'roll' ? current.roll.roller_color : current.hidden.roller_color
  const name = current.kind === 'roll' ? current.roll.roller_name : current.hidden.roller_name
  const c = colorOf(color)
  const faces = current.kind === 'roll' ? current.roll.faces : [null, null, null, null]
  const seed = current.kind === 'roll' ? current.roll.id : current.hidden.id
  const mine = current.kind === 'roll' && current.roll.user_id === uid

  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-40 flex justify-center px-3">
      <button
        type="button"
        onClick={() => store.finished(current.key, mine)}
        className="pointer-events-auto flex w-full max-w-sm flex-col items-center gap-3 rounded-3xl border-2 bg-[color:var(--card)]/95 px-4 py-4 shadow-2xl backdrop-blur"
        style={{ borderColor: c.fill }}
        aria-label="Dismiss roll"
      >
        <span className="text-sm font-semibold" style={{ color: c.fill }}>
          {name}
          {current.kind === 'roll' && current.revealed && ' · revealed'}
          {current.kind === 'roll' && current.roll.is_hidden && ' · hidden'}
        </span>
        <DiceRow seed={seed} faces={faces} color={color} />
        <span className={`min-h-7 text-center text-lg font-bold transition-opacity ${landed ? 'opacity-100' : 'opacity-0'}`}>
          {current.kind === 'roll' ? rollBreakdown(current.roll) : 'rolled behind the screen'}
        </span>
      </button>
      <p className="sr-only" aria-live="assertive">
        {landed ? (current.kind === 'roll' ? `${name}: ${rollBreakdown(current.roll)}` : `${name} rolled behind the screen`) : ''}
      </p>
    </div>
  )
}
