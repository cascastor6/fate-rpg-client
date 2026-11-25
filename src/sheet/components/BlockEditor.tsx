import { useCallback, useState } from 'react'
import { signed } from '../../dice/ladder.ts'
import { BottomSheet } from '../../ui/BottomSheet.tsx'
import { Button } from '../../ui/primitives.tsx'
import { Stepper } from '../../ui/Stepper.tsx'
import type { BlockPatch, SheetOpBody } from '../ops.ts'
import type { BlockRow } from '../types.ts'
import { blockProblem } from '../validate.ts'

/**
 * Bottom-sheet editor for one block (SPEC §6.1). Saves a single patch with only the
 * changed fields when you press Done or dismiss the sheet; Cancel discards.
 */
export function BlockEditor({
  block,
  onClose,
  send,
}: {
  block: BlockRow
  onClose: () => void
  send: (op: SheetOpBody) => void
}) {
  const isNumeric = block.type === 'skill' || block.type === 'number' || block.type === 'counter'
  const [label, setLabel] = useState(block.label)
  const [text, setText] = useState(typeof block.value === 'string' ? block.value : '')
  const [numText, setNumText] = useState(String(typeof block.value === 'number' ? block.value : 0))
  const [invokes, setInvokes] = useState(block.props.free_invokes ?? 0)
  const [problem, setProblem] = useState<string | null>(null)

  const numValue = Number(numText)

  const save = useCallback(() => {
    const patch: BlockPatch = {}
    // Name is editable for skills (NPC skills start blank) and for counters/numbers.
    if (isNumeric && label.trim() !== block.label) patch.label = label.trim()
    if (isNumeric) {
      if (numText.trim() === '' || !Number.isFinite(numValue)) {
        setProblem('Enter a number.')
        return
      }
      const v = block.type === 'number' ? numValue : Math.trunc(numValue)
      if (v !== block.value) patch.value = v
    } else if (text !== block.value) {
      patch.value = block.type === 'image' ? text.trim() : text
    }
    if (block.type === 'consequence' && invokes !== (block.props.free_invokes ?? 0)) {
      patch.props = { free_invokes: invokes || null }
    }
    if (Object.keys(patch).length) {
      const value = 'value' in patch ? patch.value : block.value
      const props = { ...block.props, ...(patch.props ?? {}) }
      if (props.free_invokes === null) delete props.free_invokes
      const err = blockProblem(block.type, value, props as Record<string, unknown>)
      if (err) {
        setProblem(err.charAt(0).toUpperCase() + err.slice(1) + '.')
        return
      }
      send({ kind: 'patch', blockId: block.id, patch })
    }
    onClose()
  }, [block, invokes, isNumeric, label, numText, numValue, onClose, send, text])

  const title = block.label || (block.type === 'skill' ? 'Skill' : block.type.charAt(0).toUpperCase() + block.type.slice(1))
  const counterMax = block.type === 'counter' ? block.props.max : undefined

  return (
    <BottomSheet open title={title} onDismiss={save}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        {isNumeric && (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">Name</span>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={200}
                placeholder={block.type === 'skill' ? 'e.g. Fight' : 'Name'}
                className="min-h-12 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg)] px-3 text-base"
              />
            </label>
            <div className="flex flex-col items-center gap-3 py-2">
              <Stepper
                size="lg"
                label={label || 'value'}
                value={Number.isFinite(numValue) ? numValue : 0}
                format={block.type === 'skill' ? signed : String}
                min={block.type === 'counter' ? 0 : undefined}
                max={counterMax}
                onStep={(d) => {
                  setProblem(null)
                  setNumText(String((Number.isFinite(numValue) ? numValue : 0) + d))
                }}
              />
              <input
                inputMode={block.type === 'number' ? 'decimal' : 'numeric'}
                value={numText}
                onChange={(e) => { setNumText(e.target.value); setProblem(null) }}
                aria-label="Value"
                data-autofocus
                className="min-h-12 w-32 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg)] px-3 text-center text-xl tabular-nums"
              />
            </div>
          </>
        )}

        {(block.type === 'text' || block.type === 'aspect' || block.type === 'consequence') && (
          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value); setProblem(null) }}
            rows={block.type === 'text' ? 6 : 3}
            maxLength={2000}
            placeholder={block.props.hint || (block.type === 'consequence' ? 'Empty means the slot is free' : '')}
            data-autofocus
            className="min-h-28 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg)] p-3 text-lg leading-snug"
            aria-label={title}
          />
        )}

        {block.type === 'consequence' && (
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Free invokes</span>
            <Stepper label="free invokes" value={invokes} min={0} max={99} onStep={(d) => setInvokes(Math.max(0, invokes + d))} />
          </div>
        )}

        {block.type === 'image' && (
          <input
            type="url"
            inputMode="url"
            value={text}
            onChange={(e) => { setText(e.target.value); setProblem(null) }}
            placeholder="https://…"
            data-autofocus
            className="min-h-12 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg)] px-3 text-base"
            aria-label="Image URL"
          />
        )}

        {problem && <p className="text-sm text-red-700 dark:text-red-400" role="alert">{problem}</p>}

        <div className="flex gap-2">
          <Button type="submit" className="flex-1">Done</Button>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </BottomSheet>
  )
}
