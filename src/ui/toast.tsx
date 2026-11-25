import { useEffect, useState } from 'react'

// Minimal toast bus (polished in Slice 8). Anything can call toast(); <Toaster/> renders them.

type Toast = { id: number; message: string; tone: 'info' | 'error' }
let nextId = 1
let toasts: Toast[] = []
const listeners = new Set<(t: Toast[]) => void>()

function emit() {
  for (const l of listeners) l(toasts)
}

export function toast(message: string, tone: Toast['tone'] = 'info', ms = 3500) {
  const t = { id: nextId++, message, tone }
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
          className={`pointer-events-auto max-w-sm rounded-xl px-4 py-3 text-sm shadow-lg ${
            t.tone === 'error' ? 'bg-red-700 text-white' : 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  )
}
