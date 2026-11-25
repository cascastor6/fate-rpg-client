import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Mobile bottom sheet (SPEC §9.1): portal + backdrop, drag the handle down or tap the
 * backdrop / press Escape to dismiss, and it stays above the on-screen keyboard.
 * `onDismiss` is called for every way of closing that isn't an explicit button.
 */
export function BottomSheet({
  open,
  title,
  onDismiss,
  children,
}: {
  open: boolean
  title: string
  onDismiss: () => void
  children: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)
  const [dragY, setDragY] = useState(0)
  const [keyboard, setKeyboard] = useState(0)
  const start = useRef<number | null>(null)
  // Keep the latest callback without re-running the open/close effect on every render.
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss

  // Keep the sheet above the keyboard: visualViewport shrinks when it opens.
  useEffect(() => {
    if (!open || !window.visualViewport) return
    const vv = window.visualViewport
    const update = () => setKeyboard(Math.max(0, window.innerHeight - vv.height - vv.offsetTop))
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && dismissRef.current()
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const previouslyFocused = document.activeElement as HTMLElement | null
    // Focus the first input (or the panel) once mounted.
    requestAnimationFrame(() => {
      const first = panel.current?.querySelector<HTMLElement>('[data-autofocus], input, textarea, button')
      first?.focus()
    })
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      previouslyFocused?.focus?.()
    }
  }, [open])

  if (!open) return null

  // Simple focus trap: keep Tab inside the panel.
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Tab' || !panel.current) return
    const items = panel.current.querySelectorAll<HTMLElement>('button, input, textarea, select, a[href], [tabindex]:not([tabindex="-1"])')
    if (!items.length) return
    const first = items[0], last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  return createPortal(
    <div className="fixed inset-0 z-40" onKeyDown={onKeyDown}>
      <div className="absolute inset-0 bg-black/40" onClick={() => dismissRef.current()} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="absolute inset-x-0 mx-auto flex max-h-[85dvh] max-w-screen-sm flex-col rounded-t-3xl bg-[color:var(--card)] shadow-2xl"
        style={{
          bottom: keyboard,
          transform: dragY ? `translateY(${dragY}px)` : undefined,
          transition: start.current === null ? 'transform 150ms ease-out' : undefined,
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <div
          className="flex cursor-grab touch-none justify-center pb-2 pt-3"
          onPointerDown={(e) => {
            start.current = e.clientY
            e.currentTarget.setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => start.current !== null && setDragY(Math.max(0, e.clientY - start.current))}
          onPointerUp={() => {
            const dismiss = dragY > 80
            start.current = null
            setDragY(0)
            if (dismiss) dismissRef.current()
          }}
          aria-hidden="true"
        >
          <div className="h-1.5 w-10 rounded-full bg-black/20 dark:bg-white/25" />
        </div>
        <h2 className="px-5 pb-2 text-lg font-semibold">{title}</h2>
        <div className="overflow-y-auto px-5 pb-5">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
