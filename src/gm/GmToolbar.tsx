import { useState } from 'react'
import { friendlyError } from '../lib/errors.ts'
import { supabase } from '../lib/supabase.ts'
import { useSession } from '../session/SessionProvider.tsx'
import { IconMinus, IconPlus } from '../ui/icons.tsx'
import { Button } from '../ui/primitives.tsx'
import { toast } from '../ui/toast.tsx'
import { MembersSheet } from './MembersSheet.tsx'
import { useSpotlight } from './spotlight.ts'

/** Shared GM toolbar: fate point pool, GM roll mode, clear highlight, members. */
export function GmToolbar() {
  const { session, refresh, members } = useSession()
  const spot = useSpotlight()
  const [pool, setPool] = useState<number | null>(null) // optimistic value while saving
  const [membersOpen, setMembersOpen] = useState(false)
  const shown = pool ?? session.gm_fate_points

  const adjust = async (delta: number) => {
    const next = Math.max(0, shown + delta)
    setPool(next)
    const { error } = await supabase.rpc('adjust_gm_pool', { p_session_id: session.id, p_delta: delta })
    if (error) toast(friendlyError(error), 'error')
    await refresh()
    setPool(null)
  }

  const setMode = async (mode: 'open' | 'closed') => {
    if (mode === session.gm_roll_mode) return
    const { error } = await supabase.from('sessions').update({ gm_roll_mode: mode }).eq('id', session.id)
    if (error) toast(friendlyError(error), 'error')
    else await refresh()
  }

  return (
    <div className="mx-auto flex max-w-screen-xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="flex items-center gap-1" role="group" aria-label="GM fate point pool">
        <span className="mr-1 text-sm font-semibold">GM pool</span>
        <button type="button" className="flex size-11 items-center justify-center rounded-full border border-[color:var(--border)] disabled:opacity-30"
          onClick={() => void adjust(-1)} disabled={shown <= 0} aria-label="Spend from GM pool">
          <IconMinus />
        </button>
        <output className="min-w-8 text-center text-xl font-bold tabular-nums" aria-live="polite">{shown}</output>
        <button type="button" className="flex size-11 items-center justify-center rounded-full border border-[color:var(--border)]"
          onClick={() => void adjust(1)} aria-label="Add to GM pool">
          <IconPlus />
        </button>
      </div>

      <div className="flex rounded-xl border border-[color:var(--border)] p-1" role="radiogroup" aria-label="GM rolls">
        {(['open', 'closed'] as const).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={session.gm_roll_mode === m} onClick={() => void setMode(m)}
            className={`min-h-9 rounded-lg px-3 text-sm font-semibold ${session.gm_roll_mode === m ? 'bg-amber-700 text-white' : ''}`}>
            {m === 'open' ? 'Rolls open' : 'Rolls closed'}
          </button>
        ))}
      </div>

      {spot.current && (
        <button type="button" onClick={() => void spot.clear()} aria-label={`Clear highlight: ${spot.current.text}`}
          className="flex min-h-11 max-w-xs items-center gap-2 rounded-full bg-amber-100 px-3 text-sm font-semibold text-amber-950 dark:bg-amber-900 dark:text-amber-50">
          <span aria-hidden="true">★</span>
          <span className="truncate">{spot.current.text}</span>
          <span className="shrink-0 underline underline-offset-2">Clear highlight</span>
        </button>
      )}

      <Button variant="secondary" className="ml-auto" onClick={() => setMembersOpen(true)}>
        Members ({members.length})
      </Button>
      {membersOpen && <MembersSheet onClose={() => setMembersOpen(false)} />}
    </div>
  )
}
