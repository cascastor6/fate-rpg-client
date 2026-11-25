import { Link } from 'react-router-dom'
import { useSession } from '../session/SessionProvider.tsx'
import { colorOf } from '../ui/colors.ts'

export function SessionHeader({ subtitle }: { subtitle: string }) {
  const { session, me } = useSession()
  const c = colorOf(me.color)
  return (
    <header className="sticky top-0 z-10 border-b border-[color:var(--border)] bg-[color:var(--bg)]/90 backdrop-blur">
      <div className="h-1" style={{ background: c.fill }} aria-hidden="true" />
      <div className="mx-auto flex max-w-screen-lg items-center gap-3 px-4 py-3">
        <Link to="/" className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-xl hover:bg-black/5 dark:hover:bg-white/10" aria-label="Home">
          ←
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold leading-tight">{session.name}</h1>
          <p className="truncate text-sm text-[color:var(--muted)]">{subtitle}</p>
        </div>
      </div>
    </header>
  )
}
