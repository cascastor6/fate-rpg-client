// Play-mode block renderers (SPEC §6.1). Every interactive target is at least 44px.

import type { ReactNode } from 'react'
import { ladderName, signed } from '../../dice/ladder.ts'
import { IconDie, IconLock, IconMinus, IconPencil, IconPlus, IconRefresh } from '../../ui/icons.tsx'
import type { SheetOpBody } from '../ops.ts'
import type { BlockRow, StressBox } from '../types.ts'

export type BlockActions = {
  canEdit: boolean
  /** open the bottom-sheet editor for this block */
  edit: (block: BlockRow) => void
  /** press-to-roll a skill (wired to dice in Slice 6) */
  roll: (block: BlockRow) => void
  send: (op: SheetOpBody) => void
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const num = (v: unknown) => (typeof v === 'number' ? v : 0)

const tap =
  'w-full rounded-xl text-left transition-colors hover:bg-black/[.03] active:bg-black/[.06] dark:hover:bg-white/[.04] dark:active:bg-white/[.08] focus-visible:outline-2 focus-visible:outline-amber-600'

function Label({ children }: { children: string }) {
  return children ? (
    <span className="block text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">{children}</span>
  ) : null
}

/** A tappable area that opens the editor, or a plain div when read-only. */
function EditArea({ a, block, children, className = '' }: { a: BlockActions; block: BlockRow; children: ReactNode; className?: string }) {
  if (!a.canEdit) return <div className={`px-3 py-2 ${className}`}>{children}</div>
  return (
    <button type="button" className={`${tap} min-h-11 px-3 py-2 ${className}`} onClick={() => a.edit(block)} aria-label={`Edit ${block.label || block.type}`}>
      {children}
    </button>
  )
}

function Placeholder({ children }: { children: string }) {
  return <span className="italic text-[color:var(--muted)] opacity-70">{children}</span>
}

export function AspectBlock({ block, a }: { block: BlockRow; a: BlockActions }) {
  const value = str(block.value)
  const role = block.props.role
  const accent = role === 'high_concept' ? 'border-amber-600' : role === 'trouble' ? 'border-red-600' : 'border-transparent'
  return (
    <EditArea a={a} block={block} className={`border-l-4 ${accent}`}>
      <Label>{block.label}</Label>
      <span className="mt-0.5 block text-base font-semibold leading-snug">
        {value || <Placeholder>{a.canEdit ? block.props.hint || 'Tap to write an aspect' : '—'}</Placeholder>}
      </span>
    </EditArea>
  )
}

export function TextBlock({ block, a }: { block: BlockRow; a: BlockActions }) {
  const value = str(block.value)
  return (
    <EditArea a={a} block={block}>
      <Label>{block.label}</Label>
      <span className="mt-0.5 block whitespace-pre-wrap break-words leading-snug">
        {value || <Placeholder>{a.canEdit ? block.props.hint || 'Tap to write…' : '—'}</Placeholder>}
      </span>
    </EditArea>
  )
}

export function ConsequenceBlock({ block, a }: { block: BlockRow; a: BlockActions }) {
  const value = str(block.value)
  const invokes = block.props.free_invokes ?? 0
  return (
    <EditArea a={a} block={block}>
      <span className="flex items-center gap-2">
        <Label>{block.label}</Label>
        {block.props.shift != null && (
          <span className="rounded-md bg-black/5 px-1.5 text-xs font-bold tabular-nums dark:bg-white/10">{block.props.shift}</span>
        )}
        {invokes > 0 && (
          <span className="rounded-full bg-amber-100 px-2 text-xs font-semibold text-amber-900 dark:bg-amber-900 dark:text-amber-100">
            {invokes} free invoke{invokes === 1 ? '' : 's'}
          </span>
        )}
      </span>
      <span className="mt-0.5 block font-semibold leading-snug">
        {value || <Placeholder>{block.props.hint || 'Free'}</Placeholder>}
      </span>
    </EditArea>
  )
}

/** Press the whole row to roll; the pencil (its own target) edits (SPEC §6.1). */
export function SkillBlock({ block, a, canRoll }: { block: BlockRow; a: BlockActions; canRoll: boolean }) {
  const value = num(block.value)
  const name = block.label || 'Unnamed skill'
  const rollable = block.props.rollable !== false
  const body = (
    <>
      <IconDie className={`size-5 shrink-0 ${canRoll && rollable ? 'text-amber-700 dark:text-amber-500' : 'opacity-0'}`} />
      <span className={`flex-1 truncate ${value === 0 ? 'text-[color:var(--muted)]' : 'font-semibold'} ${block.label ? '' : 'italic'}`}>
        {name}
      </span>
      <span className="text-right">
        <span className={`block text-lg font-bold tabular-nums leading-none ${value === 0 ? 'text-[color:var(--muted)]' : ''}`}>
          {signed(value)}
        </span>
        <span className="block text-[11px] leading-tight text-[color:var(--muted)]">{ladderName(value)}</span>
      </span>
    </>
  )
  return (
    <div className="flex items-stretch gap-1">
      {canRoll && rollable ? (
        <button
          type="button"
          className={`${tap} flex min-h-12 flex-1 items-center gap-3 px-3`}
          onClick={() => a.roll(block)}
          aria-label={`Roll ${name} (${signed(value)})`}
        >
          {body}
        </button>
      ) : a.canEdit ? (
        <button type="button" className={`${tap} flex min-h-12 flex-1 items-center gap-3 px-3`} onClick={() => a.edit(block)}>
          {body}
        </button>
      ) : (
        <div className="flex min-h-12 flex-1 items-center gap-3 px-3">{body}</div>
      )}
      {a.canEdit && (
        <button
          type="button"
          className="ml-1 flex w-11 shrink-0 items-center justify-center rounded-xl border-l border-[color:var(--border)] text-[color:var(--muted)] hover:bg-black/5 hover:text-[color:var(--fg)] dark:hover:bg-white/10"
          onClick={() => a.edit(block)}
          aria-label={`Edit ${name}`}
        >
          <IconPencil className="size-4" />
        </button>
      )}
    </div>
  )
}

export function StressBlock({ block, a }: { block: BlockRow; a: BlockActions }) {
  const boxes = Array.isArray(block.value) ? (block.value as StressBox[]) : []
  return (
    <div className="px-3 py-2">
      <Label>{block.label}</Label>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {boxes.map((box, i) => {
          const common = 'relative flex size-11 items-center justify-center rounded-lg border-2 text-sm font-bold tabular-nums'
          if (box.disabled) {
            return (
              <span key={i} className={`${common} border-dashed border-[color:var(--border)] text-[color:var(--muted)]`} title="Locked">
                <IconLock className="size-4 opacity-60" />
                <span className="sr-only">Box {box.size}, locked</span>
              </span>
            )
          }
          const look = box.checked
            ? 'border-red-700 bg-red-700 text-white dark:border-red-500 dark:bg-red-600'
            : 'border-stone-400 dark:border-stone-500'
          if (!a.canEdit) {
            return <span key={i} className={`${common} ${look}`}>{box.checked ? '✕' : box.size}</span>
          }
          return (
            <button
              key={i}
              type="button"
              role="checkbox"
              aria-checked={box.checked}
              aria-label={`${block.label} box ${box.size}`}
              className={`${common} ${look} transition-colors active:scale-95`}
              onClick={() => a.send({ kind: 'stress', blockId: block.id, index: i, checked: !box.checked })}
            >
              {box.checked ? '✕' : box.size}
            </button>
          )
        })}
        {boxes.length === 0 && <Placeholder>No boxes</Placeholder>}
      </div>
    </div>
  )
}

export function CounterBlock({ block, a }: { block: BlockRow; a: BlockActions }) {
  const value = num(block.value)
  const { max, refresh } = block.props
  return (
    <div className="flex min-h-12 items-center gap-2 px-3 py-1">
      <div className="min-w-0 flex-1">
        {a.canEdit ? (
          <button type="button" className="min-h-11 text-left" onClick={() => a.edit(block)}>
            <Label>{block.label || 'Counter'}</Label>
          </button>
        ) : (
          <Label>{block.label || 'Counter'}</Label>
        )}
      </div>
      {a.canEdit && refresh != null && value !== refresh && (
        <button
          type="button"
          className="flex size-11 items-center justify-center rounded-full text-[color:var(--muted)] hover:bg-black/5 dark:hover:bg-white/10"
          onClick={() => a.send({ kind: 'patch', blockId: block.id, patch: { value: refresh } })}
          aria-label={`Reset ${block.label} to ${refresh}`}
          title={`Reset to ${refresh}`}
        >
          <IconRefresh className="size-4" />
        </button>
      )}
      {a.canEdit && (
        <button
          type="button"
          className="flex size-11 items-center justify-center rounded-full border border-[color:var(--border)] disabled:opacity-30"
          onClick={() => a.send({ kind: 'adjust', blockId: block.id, delta: -1 })}
          disabled={value <= 0}
          aria-label={`Decrease ${block.label}`}
        >
          <IconMinus />
        </button>
      )}
      <span className="min-w-12 text-center text-lg font-bold tabular-nums">
        {value}
        {max != null && <span className="text-sm font-normal text-[color:var(--muted)]">/{max}</span>}
      </span>
      {a.canEdit && (
        <button
          type="button"
          className="flex size-11 items-center justify-center rounded-full border border-[color:var(--border)] disabled:opacity-30"
          onClick={() => a.send({ kind: 'adjust', blockId: block.id, delta: 1 })}
          disabled={max != null && value >= max}
          aria-label={`Increase ${block.label}`}
        >
          <IconPlus />
        </button>
      )}
    </div>
  )
}

export function NumberBlock({ block, a }: { block: BlockRow; a: BlockActions }) {
  return (
    <EditArea a={a} block={block} className="flex items-center justify-between gap-3">
      <Label>{block.label || 'Number'}</Label>
      <span className="text-lg font-bold tabular-nums">{num(block.value)}</span>
    </EditArea>
  )
}

export function ImageBlock({ block, a }: { block: BlockRow; a: BlockActions }) {
  const url = str(block.value)
  return (
    <EditArea a={a} block={block}>
      <Label>{block.label}</Label>
      {url ? (
        <img
          src={url}
          alt={block.props.alt || block.label || ''}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="mt-1 max-h-72 w-full rounded-xl object-contain"
        />
      ) : (
        <span className="mt-1 flex h-24 items-center justify-center rounded-xl border-2 border-dashed border-[color:var(--border)]">
          <Placeholder>{a.canEdit ? 'Tap to add an image URL' : 'No image'}</Placeholder>
        </span>
      )}
    </EditArea>
  )
}

export function SeparatorBlock({ block }: { block: BlockRow }) {
  return (
    <div className="flex items-center gap-3 px-3 pt-3 pb-1" role="separator">
      {block.label && <span className="text-sm font-semibold text-[color:var(--muted)]">{block.label}</span>}
      <hr className="flex-1 border-[color:var(--border)]" />
    </div>
  )
}

export function BlockView({ block, a, canRoll }: { block: BlockRow; a: BlockActions; canRoll: boolean }) {
  switch (block.type) {
    case 'aspect': return <AspectBlock block={block} a={a} />
    case 'text': return <TextBlock block={block} a={a} />
    case 'consequence': return <ConsequenceBlock block={block} a={a} />
    case 'skill': return <SkillBlock block={block} a={a} canRoll={canRoll} />
    case 'stress': return <StressBlock block={block} a={a} />
    case 'counter': return <CounterBlock block={block} a={a} />
    case 'number': return <NumberBlock block={block} a={a} />
    case 'image': return <ImageBlock block={block} a={a} />
    case 'separator': return <SeparatorBlock block={block} />
  }
}
