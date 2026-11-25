import { useCallback, useState, type ReactNode } from 'react'
import { BottomSheet } from '../../ui/BottomSheet.tsx'
import { IconMinus, IconPlus, IconX } from '../../ui/icons.tsx'
import { Button } from '../../ui/primitives.tsx'
import { Stepper } from '../../ui/Stepper.tsx'
import { BLOCK_TYPE_INFO, convertibleTypes, typeChangePatch } from '../defaults.ts'
import type { BlockPatch, SheetOpBody } from '../ops.ts'
import { PROPS_BY_TYPE, type AspectRole, type BlockProps, type BlockRow, type BlockType, type StressBox } from '../types.ts'
import { blockProblem } from '../validate.ts'

const input = 'min-h-12 w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--bg)] px-3 text-base'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-11 items-center justify-between gap-3">
      <span className="text-sm font-medium">{label}</span>
      <input type="checkbox" className="size-6 accent-amber-700" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

/** Optional whole number (empty = not set). */
function OptionalInt({ label, value, onChange }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void }) {
  return (
    <Field label={label}>
      <input
        inputMode="numeric"
        className={input}
        value={value ?? ''}
        placeholder="None"
        onChange={(e) => {
          const t = e.target.value.trim()
          if (t === '') onChange(undefined)
          else if (/^\d{1,3}$/.test(t)) onChange(Number(t))
        }}
      />
    </Field>
  )
}

/**
 * Edit-mode settings for one block (SPEC §6.2): label, type (lossless conversions only),
 * type-specific fields, hint, and delete. Saves one patch on Done or dismiss.
 */
export function BlockSettings({
  block,
  send,
  onClose,
  onDelete,
}: {
  block: BlockRow
  send: (op: SheetOpBody) => void
  onClose: () => void
  onDelete: (block: BlockRow) => void
}) {
  const [label, setLabel] = useState(block.label)
  const [type, setType] = useState<BlockType>(block.type)
  const [props, setProps] = useState<BlockProps>(block.props)
  const [boxes, setBoxes] = useState<StressBox[]>(Array.isArray(block.value) ? (block.value as StressBox[]) : [])
  const [problem, setProblem] = useState<string | null>(null)

  const set = <K extends keyof BlockProps>(k: K, v: BlockProps[K] | undefined) =>
    setProps((p) => {
      const next = { ...p }
      if (v === undefined || v === '') delete next[k]
      else next[k] = v
      return next
    })

  const save = useCallback(() => {
    let patch: BlockPatch = {}
    if (label !== block.label) patch.label = label
    if (type !== block.type) patch = { ...patch, ...typeChangePatch(block, type) }

    // Final props = draft props restricted to what the final type allows.
    const allowed = PROPS_BY_TYPE[type] as readonly string[]
    const finalProps: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(props)) if (allowed.includes(k)) finalProps[k] = v
    const diff: Record<string, unknown> = {}
    for (const k of new Set([...Object.keys(block.props), ...Object.keys(finalProps)])) {
      const before = (block.props as Record<string, unknown>)[k]
      const after = finalProps[k]
      if (before !== after) diff[k] = after === undefined ? null : after
    }
    if (Object.keys(diff).length) patch.props = diff as BlockPatch['props']

    if (type === 'stress' && JSON.stringify(boxes) !== JSON.stringify(block.value)) patch.value = boxes

    if (Object.keys(patch).length) {
      const value = 'value' in patch ? patch.value : block.value
      const err = blockProblem(type, value, finalProps)
      if (err) {
        setProblem(err.charAt(0).toUpperCase() + err.slice(1) + '.')
        return
      }
      send({ kind: 'patch', blockId: block.id, patch })
    }
    onClose()
  }, [block, boxes, label, onClose, props, send, type])

  const types = [block.type, ...convertibleTypes(block.type)]

  return (
    <BottomSheet open title={`${BLOCK_TYPE_INFO[block.type].name} settings`} onDismiss={save}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); save() }}>
        <Field label={type === 'separator' ? 'Heading (optional)' : 'Label'}>
          <input className={input} value={label} maxLength={200} onChange={(e) => setLabel(e.target.value)} data-autofocus />
        </Field>

        {types.length > 1 && (
          <Field label="Type">
            <select className={input} value={type} onChange={(e) => setType(e.target.value as BlockType)}>
              {types.map((t) => <option key={t} value={t}>{BLOCK_TYPE_INFO[t].name}</option>)}
            </select>
          </Field>
        )}

        {type === 'aspect' && (
          <Field label="Kind of aspect">
            <select className={input} value={props.role ?? 'other'} onChange={(e) => set('role', e.target.value as AspectRole)}>
              <option value="high_concept">High concept</option>
              <option value="trouble">Trouble</option>
              <option value="other">Other</option>
            </select>
          </Field>
        )}
        {type === 'skill' && (
          <Toggle label="Rollable (press to roll)" checked={props.rollable !== false} onChange={(v) => set('rollable', v)} />
        )}
        {type === 'text' && (
          <Toggle label="Multi-line" checked={props.multiline === true} onChange={(v) => set('multiline', v)} />
        )}
        {type === 'consequence' && (
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Shifts absorbed</span>
            <Stepper label="shifts" value={props.shift ?? 0} min={0} max={99} onStep={(d) => set('shift', Math.max(0, (props.shift ?? 0) + d))} />
          </div>
        )}
        {type === 'counter' && (
          <div className="grid grid-cols-2 gap-3">
            <OptionalInt label="Max" value={props.max} onChange={(v) => set('max', v)} />
            <OptionalInt label="Reset to" value={props.refresh} onChange={(v) => set('refresh', v)} />
          </div>
        )}
        {type === 'image' && (
          <Field label="Description (for screen readers)">
            <input className={input} value={props.alt ?? ''} maxLength={200} onChange={(e) => set('alt', e.target.value)} />
          </Field>
        )}
        {type === 'stress' && <StressBoxesEditor boxes={boxes} onChange={setBoxes} />}

        {type !== 'separator' && (
          <Field label="Hint (shown when empty)">
            <input className={input} value={props.hint ?? ''} maxLength={200} onChange={(e) => set('hint', e.target.value)} />
          </Field>
        )}

        {problem && <p className="text-sm text-red-700 dark:text-red-400" role="alert">{problem}</p>}

        <div className="flex gap-2">
          <Button type="submit" className="flex-1">Done</Button>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
        <Button variant="ghost" className="text-red-700 dark:text-red-400" onClick={() => onDelete(block)}>
          Delete this block
        </Button>
      </form>
    </BottomSheet>
  )
}

function StressBoxesEditor({ boxes, onChange }: { boxes: StressBox[]; onChange: (b: StressBox[]) => void }) {
  const update = (i: number, patch: Partial<StressBox>) =>
    onChange(boxes.map((b, j) => {
      if (j !== i) return b
      const next = { ...b, ...patch }
      if (!next.disabled) delete next.disabled
      return next
    }))
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">Boxes</legend>
      {boxes.map((b, i) => (
        <div key={i} className="flex items-center gap-2 rounded-xl border border-[color:var(--border)] px-2 py-1">
          <span className="w-12 text-sm text-[color:var(--muted)]">Box {i + 1}</span>
          <Stepper label={`box ${i + 1} size`} value={b.size} min={1} max={10} onStep={(d) => update(i, { size: Math.min(10, Math.max(1, b.size + d)) })} />
          <label className="ml-auto flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="size-5 accent-amber-700" checked={!!b.disabled} onChange={(e) => update(i, { disabled: e.target.checked, checked: false })} />
            Locked
          </label>
          <button
            type="button"
            className="flex size-11 items-center justify-center rounded-full text-[color:var(--muted)] hover:bg-black/5 dark:hover:bg-white/10"
            onClick={() => onChange(boxes.filter((_, j) => j !== i))}
            aria-label={`Remove box ${i + 1}`}
          >
            <IconX className="size-4" />
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <Button
          variant="secondary"
          disabled={boxes.length >= 20}
          onClick={() => onChange([...boxes, { size: Math.min(10, (boxes[boxes.length - 1]?.size ?? 0) + 1), checked: false }])}
        >
          <IconPlus className="size-4" /> Add box
        </Button>
        {boxes.length > 0 && (
          <Button variant="ghost" onClick={() => onChange(boxes.slice(0, -1))}>
            <IconMinus className="size-4" /> Remove last
          </Button>
        )}
      </div>
    </fieldset>
  )
}
