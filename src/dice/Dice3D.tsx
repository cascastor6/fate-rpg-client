import { useEffect, useMemo, useRef } from 'react'
import { colorOf } from '../ui/colors.ts'
import { dieMotion, FACE_VALUE, type Face } from './prng.ts'

const SIZE = 56 // px, cube edge
const DURATION = 1400
const STAGGER = 60

const FACE_TRANSFORM: Record<Face, string> = {
  front: `rotateY(0deg) translateZ(${SIZE / 2}px)`,
  back: `rotateY(180deg) translateZ(${SIZE / 2}px)`,
  right: `rotateY(90deg) translateZ(${SIZE / 2}px)`,
  left: `rotateY(-90deg) translateZ(${SIZE / 2}px)`,
  top: `rotateX(90deg) translateZ(${SIZE / 2}px)`,
  bottom: `rotateX(-90deg) translateZ(${SIZE / 2}px)`,
}

const symbol = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '')
const rot = (r: { x: number; y: number; z: number }) => `rotateZ(${r.z}deg) rotateX(${r.x}deg) rotateY(${r.y}deg)`

export const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * One CSS 3D Fudge die (SPEC §7.2) in the roller's colour. With `value` it tumbles onto
 * that face; with `value === null` (a closed GM roll) every face shows "?".
 */
function Die({ seed, index, value, color }: { seed: string; index: number; value: number | null; color: string }) {
  const cube = useRef<HTMLDivElement>(null)
  const c = colorOf(color)
  // Memoised so re-renders (e.g. the result text appearing) never restart the tumble.
  const motion = useMemo(() => dieMotion(seed, index, value ?? 0), [seed, index, value])

  useEffect(() => {
    const el = cube.current
    if (!el) return
    if (reducedMotion()) {
      el.style.transform = rot(motion.end)
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, fill: 'both' })
      return
    }
    const anim = el.animate(
      [
        { transform: `translateY(-40px) ${rot(motion.start)}` },
        { transform: `translateY(6px) ${rot({ x: (motion.start.x + motion.end.x) / 2, y: (motion.start.y + motion.end.y) / 2, z: 0 })}`, offset: 0.7 },
        { transform: `translateY(0) ${rot(motion.end)}` },
      ],
      { duration: DURATION, delay: index * STAGGER, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'both' },
    )
    return () => anim.cancel()
  }, [motion, index])

  return (
    <div className="[perspective:600px]" style={{ width: SIZE, height: SIZE }}>
      <div ref={cube} className="relative size-full [transform-style:preserve-3d]" style={{ transform: rot(motion.end) }}>
        {(Object.keys(FACE_TRANSFORM) as Face[]).map((f) => (
          <div
            key={f}
            className="absolute inset-0 flex items-center justify-center rounded-xl border-2 text-4xl font-black [backface-visibility:hidden]"
            style={{ transform: FACE_TRANSFORM[f], background: c.fill, color: c.ink, borderColor: 'rgba(0,0,0,.25)' }}
          >
            {value === null ? '?' : symbol(FACE_VALUE[f])}
          </div>
        ))}
      </div>
    </div>
  )
}

export function DiceRow({ seed, faces, color }: { seed: string; faces: (number | null)[]; color: string }) {
  return (
    <div className="flex items-center justify-center gap-3" aria-hidden="true">
      {faces.map((v, i) => <Die key={`${seed}-${i}`} seed={seed} index={i} value={v} color={color} />)}
    </div>
  )
}

/** Small flat dice for the log. */
export function MiniDice({ faces, color }: { faces: (number | null)[]; color: string }) {
  const c = colorOf(color)
  return (
    <span className="inline-flex gap-1" aria-hidden="true">
      {faces.map((v, i) => (
        <span key={i} className="flex size-6 items-center justify-center rounded-md text-sm font-black" style={{ background: c.fill, color: c.ink }}>
          {v === null ? '?' : symbol(v)}
        </span>
      ))}
    </span>
  )
}

export const LANDING_MS = DURATION + 3 * STAGGER
