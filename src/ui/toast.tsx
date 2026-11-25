import { useEffect, useState } from 'react'

// Minimal toast bus (polished in Slice 8). Anything can call toast(); <Toaster/> renders them.

type ToastAction = { label: string; onClick: () => void }
type Toast = { id: number; message: string; tone: 'info' | 'error'; action?: ToastAction }
let nextId = 1
let toasts: Toast[] = []
const listeners = new Set<(t: Toast[]) => void>()

function emit() {
  for (const l of listeners) l(toasts)
}

export function toast(message: string, tone: Toast['tone'] = 'info', ms = 3500, action?: ToastAction) {
  const t: Toast = { id: nextId++, message, tone, action }
  toasts = [...toasts.slice(-2), t]
  emit()
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id)
    emit()
  }, ms)
}

export function Toaster() {
  const [list, setList] = useState<Toast[]>(toasts)
  useEffect(() => {
    listeners.add(setList)
    return () => void listeners.delete(setList)
  }, [])
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-50 flex flex-col items-center gap-2 px-4"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 96px)' }}
      aria-live="polite"
    >
      {list.map((t) => (
        <div
          key={t.id}
          role={t.tone === 'error' ? 'alert' : 'status'}
          className={`pointer-events-auto flex max-w-sm items-center rounded-xl px-4 py-3 text-sm shadow-lg ${
            t.tone === 'error' ? 'bg-red-700 text-white' : 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
          }`}
        >
          <span>{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="-my-2 ml-3 min-h-11 rounded-lg px-3 font-bold text-amber-300 underline-offset-4 hover:underline dark:text-amber-700"
              onClick={() => {
                t.action!.onClick()
                toasts = toasts.filter((x) => x.id !== t.id)
                emit()
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
