import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useSession } from '../session/SessionProvider.tsx'
import { getSheetStore } from '../sheet/store.ts'
import { BottomSheet } from '../ui/BottomSheet.tsx'
import { Button } from '../ui/primitives.tsx'
import { Stepper } from '../ui/Stepper.tsx'
import { ladderName, signed } from './ladder.ts'
import { useDice } from './useDice.ts'

/**
 * Roll dialog (SPEC §7.4): plain 4dF or a skill, with a −5…+5 bonus. The GM can pick any
 * PC or NPC and choose open or closed for this roll.
 */
export function RollDialog() {
  const { store, dialog } = useDice()
  if (!dialog) return null
  return <Dialog key={dialog.characterId ?? 'none'} initialCharacter={dialog.characterId} onClose={() => store.closeDialog()} />
}

function Dialog({ initialCharacter, onClose }: { initialCharacter?: string; onClose: () => void }) {
  const { isGm, uid, characters, session } = useSession()
  const { store } = useDice()
  const rollable = characters.filter((c) => (isGm ? c.kind !== 'template' : c.kind === 'pc' && c.owner_id === uid))
  const [characterId, setCharacterId] = useState<string | undefined>(
    initialCharacter && rollable.some((c) => c.id === initialCharacter) ? initialCharacter : rollable[0]?.id,
  )
  const [query, setQuery] = useState('')
  const [bonus, setBonus] = useState(0)
  const [hidden, setHidden] = useState(session.gm_roll_mode === 'closed')

  const sheet = characterId ? getSheetStore(characterId) : null
  const snap = useSyncExternalStore(
    (fn) => (sheet ? sheet.subscribe(fn) : () => {}),
    () => (sheet ? sheet.getSnapshot() : null),
  )
  useEffect(() => {
    if (sheet && snap?.status !== 'ready') void sheet.load()
  }, [sheet, snap?.status])

  const skills = useMemo(() => {
    if (snap?.status !== 'ready') return []
    const q = query.trim().toLowerCase()
    return snap.data.blocks
      .filter((b) => b.type === 'skill' && b.props.rollable !== false)
      .filter((b) => !q || b.label.toLowerCase().includes(q))
      .sort((a, b) => (b.value as number) - (a.value as number) || a.label.localeCompare(b.label))
  }, [snap, query])

  const go = (blockId?: string) => {
    onClose()
    void store.roll({
      characterId: blockId ? characterId : undefined,
      blockId,
      bonus,
      hidden: isGm ? hidden : undefined,
    })
  }

  return (
    <BottomSheet open title="Roll 4dF" onDismiss={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">Bonus (e.g. +2 for an invoke)</span>
          <Stepper label="bonus" value={bonus} min={-5} max={5} format={signed} onStep={(d) => setBonus(Math.max(-5, Math.min(5, bonus + d)))} />
        </div>
        {isGm && (
          <div className="flex rounded-xl border border-[color:var(--border)] p-1" role="radiogroup" aria-label="Who sees this roll">
            {([false, true] as const).map((h) => (
              <button
                key={String(h)}
                type="button"
                role="radio"
                aria-checked={hidden === h}
                onClick={() => setHidden(h)}
                className={`min-h-11 flex-1 rounded-lg text-sm font-semibold ${hidden === h ? 'bg-amber-700 text-white' : ''}`}
              >
                {h ? 'Closed (only GMs see it)' : 'Open (everyone sees it)'}
              </button>
            ))}
          </div>
        )}
        <Button onClick={() => go()} data-autofocus>Plain 4dF{bonus ? ` ${signed(bonus)}` : ''}</Button>

        {rollable.length > 0 && (
          <div className="flex flex-col gap-2">
            {rollable.length > 1 && (
              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium">Character</span>
                <select
                  value={characterId}
                  onChange={(e) => setCharacterId(e.target.value)}
                  className="min-h-12 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg)] px-3"
                >
                  {rollable.map((c) => <option key={c.id} value={c.id}>{c.name}{c.kind === 'npc' ? ' (NPC)' : ''}</option>)}
                </select>
              </label>
            )}
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a skill…"
              aria-label="Find a skill"
              className="min-h-11 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg)] px-3"
            />
            <ul className="flex max-h-72 flex-col overflow-y-auto">
              {skills.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => go(b.id)}
                    className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-black/5 dark:hover:bg-white/10"
                  >
                    <span className="flex-1 truncate font-medium">{b.label || 'Unnamed skill'}</span>
                    <span className="text-sm text-[color:var(--muted)]">{ladderName(b.value as number)}</span>
                    <span className="w-10 text-right font-bold tabular-nums">{signed(b.value as number)}</span>
                  </button>
                </li>
              ))}
              {snap?.status === 'ready' && skills.length === 0 && (
                <li className="px-3 py-2 text-sm text-[color:var(--muted)]">{query ? 'No matching skills.' : 'No rollable skills on this sheet.'}</li>
              )}
            </ul>
          </div>
        )}
      </div>
    </BottomSheet>
  )
}
