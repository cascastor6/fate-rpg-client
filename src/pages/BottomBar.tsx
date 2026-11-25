import type { ReactNode } from 'react'

/** Sticky bottom bar with safe-area padding (SPEC §9.1). Pages add bottom padding (pb-28). */
export function BottomBar({ children }: { children: ReactNode }) {
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-30 border-t border-[color:var(--border)] bg-[color:var(--card)]/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto flex max-w-screen-sm items-center gap-2 px-3 py-2">{children}</div>
    </div>
  )
}
