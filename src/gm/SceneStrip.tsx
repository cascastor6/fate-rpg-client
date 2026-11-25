import { useState, type FormEvent } from 'react'
import { friendlyError } from '../lib/errors.ts'
import { positionBetween } from '../lib/positions.ts'
import { supabase } from '../lib/supabase.ts'
import { useSession } from '../session/SessionProvider.tsx'
import { colorOf } from '../ui/colors.ts'
import { IconMinus, IconPlus } from '../ui/icons.tsx'
import { Button } from '../ui/primitives.tsx'
import { toast } from '../ui/toast.tsx'
import { useSpotlight } from './spotlight.ts'

/** Compact list of the active scene's aspects with free invokes (SPEC §8.1). Tap to spotlight. */
export function SceneStrip() {
  const { session, sceneAspects, me } = useSession()
  const spot = useSpotlight()
  const [text, setText] = useState('')
  const gmColor = colorOf(me.color)

  const add = async (e: FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (!t || !session.active_scene_id) return
    setText('')
    const { error } = await supabase.from('scene_aspects').insert({
      scene_id: session.active_scene_id, text: t.slice(0, 200), position: positionBetween(sceneAspects.at(-1)?.position, null),
    })
    if (error) toast(friendlyError(error), 'error')
  }
  const invokes = async (id: string, value: number) => {
    const { error } = await supabase.from('scene_aspects').update({ free_invokes: Math.max(0, Math.min(99, value)) }).eq('id', id)
    if (error) toast(friendlyError(error), 'error')
  }

  if (!session.active_scene_id) {
    return <p className="text-sm text-[color:var(--muted)]">No scene is shown to players. Pick one in Scenes &amp; NPCs.</p>
  }
  return (
    <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-3" aria-label="Scene aspects">
      <h2 className="px-1 text-sm font-semibold uppercase tracking-wide text-[color:var(--muted)]">Scene aspects</h2>
      <ul className="mt-1 flex flex-wrap gap-2">
        {sceneAspects.map((a) => {
          const lit = spot.isSceneAspectLit(a.id)
          return (
            <li key={a.id} className="flex items-center gap-1 rounded-xl border border-[color:var(--border)] pl-1"
              style={lit ? { outline: `3px solid ${gmColor.fill}`, background: `${gmColor.fill}1a` } : undefined}>
              <button type="button" onClick={() => void spot.toggleSceneAspect(a.id)} aria-pressed={lit}
                aria-label={`${lit ? 'Clear highlight on' : 'Highlight for everyone:'} ${a.text}`}
                className="min-h-11 px-2 text-left font-semibold">
                {lit && '★ '}{a.text}
              </button>
              <span className="flex items-center" role="group" aria-label={`Free invokes on ${a.text}`}>
                <button type="button" className="flex size-9 items-center justify-center rounded-full disabled:opacity-30" disabled={a.free_invokes <= 0}
                  onClick={() => void invokes(a.id, a.free_invokes - 1)} aria-label="Remove a free invoke"><IconMinus className="size-4" /></button>
                <span className="min-w-5 text-center text-sm font-bold tabular-nums" title="Free invokes">{a.free_invokes}</span>
                <button type="button" className="flex size-9 items-center justify-center rounded-full"
                  onClick={() => void invokes(a.id, a.free_invokes + 1)} aria-label="Add a free invoke"><IconPlus className="size-4" /></button>
              </span>
            </li>
          )
        })}
        {sceneAspects.length === 0 && <li className="px-1 text-sm text-[color:var(--muted)]">No scene aspects yet.</li>}
      </ul>
      <form className="mt-2 flex gap-2" onSubmit={add}>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={200} placeholder="Add a scene aspect, e.g. On Fire"
          aria-label="New scene aspect" className="min-h-11 min-w-0 flex-1 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg)] px-3" />
        <Button type="submit" variant="secondary" disabled={!text.trim()}>Add</Button>
      </form>
    </section>
  )
}
