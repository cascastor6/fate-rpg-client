import { useState } from 'react'
import { friendlyError } from '../lib/errors.ts'
import { supabase } from '../lib/supabase.ts'
import { useSession } from '../session/SessionProvider.tsx'
import { Card } from '../ui/primitives.tsx'
import { toast } from '../ui/toast.tsx'

/** GM rolls: open (everyone sees) or closed (behind the screen) by default (SPEC §7.9). */
export function GmRollsCard() {
  const { session, refresh } = useSession()
  const [busy, setBusy] = useState(false)
  const set = async (mode: 'open' | 'closed') => {
    if (mode === session.gm_roll_mode) return
    setBusy(true)
    const { error } = await supabase.from('sessions').update({ gm_roll_mode: mode }).eq('id', session.id)
    if (error) toast(friendlyError(error), 'error')
    else await refresh()
    setBusy(false)
  }
  return (
    <Card>
      <h2 className="text-lg font-semibold">GM rolls</h2>
      <p className="mt-1 text-sm text-[color:var(--muted)]">
        Closed rolls show players only face-down dice until you tap Reveal in the roll log. You can override this per roll (long-press the die button).
      </p>
      <div className="mt-3 flex rounded-xl border border-[color:var(--border)] p-1" role="radiogroup" aria-label="GM rolls">
        {(['open', 'closed'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={session.gm_roll_mode === m}
            disabled={busy}
            onClick={() => void set(m)}
            className={`min-h-11 flex-1 rounded-lg text-sm font-semibold ${session.gm_roll_mode === m ? 'bg-amber-700 text-white' : ''}`}
          >
            {m === 'open' ? 'Open' : 'Closed (behind the screen)'}
          </button>
        ))}
      </div>
    </Card>
  )
}
