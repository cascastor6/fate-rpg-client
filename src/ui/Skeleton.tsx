/** Grey placeholder shapes while something loads (SPEC §12). */
export function Bar({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-black/[.07] dark:bg-white/[.08] ${className}`} aria-hidden="true" />
}

export function SheetSkeleton() {
  return (
    <div className="mx-auto flex max-w-screen-sm flex-col gap-3 px-3 pt-4" role="status" aria-label="Loading sheet">
      <Bar className="h-9 w-48" />
      <Bar className="h-12 w-full" />
      {[5, 8, 3].map((n, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-4">
          <Bar className="h-5 w-28" />
          {Array.from({ length: n }, (_, j) => <Bar key={j} className="h-9 w-full" />)}
        </div>
      ))}
    </div>
  )
}

export function CardSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-3" role="status" aria-label="Loading">
      <Bar className="h-6 w-32" />
      {Array.from({ length: 5 }, (_, j) => <Bar key={j} className="h-8 w-full" />)}
    </div>
  )
}
