import { Link, NavLink } from 'react-router-dom'
import { useSession } from '../session/SessionProvider.tsx'
import { colorOf } from '../ui/colors.ts'
import { getDiceStore } from '../dice/store.ts'
import { IconBack } from '../ui/icons.tsx'

/** Sticky header: colour stripe, back link, session name, optional player tabs. */
export function SessionHeader({ subtitle, back = '/', tabs = false }: { subtitle?: string; back?: string; tabs?: boolean }) {
  const { session, me, characters, uid, isGm, connection } = useSession()
  const c = colorOf(me.color)
  const mine = characters.find((x) => x.kind === 'pc' && x.owner_id === uid)
  const tab = ({ isActive }: { isActive: boolean }) =>
    `flex min-h-11 flex-1 items-center justify-center border-b-2 text-sm font-semibold ${
      isActive ? 'border-amber-700 text-[color:var(--fg)]' : 'border-transparent text-[color:var(--muted)]'
    }`
  return (
    <header className="sticky top-0 z-20 border-b border-[color:var(--border)] bg-[color:var(--bg)]/95 backdrop-blur">
      <div className="h-1" style={{ background: c.fill }} aria-hidden="true" />
      <div className="mx-auto flex max-w-screen-lg items-center gap-2 px-2 py-2">
        <Link to={back} className="flex size-11 items-center justify-center rounded-xl hover:bg-black/5 dark:hover:bg-white/10" aria-label="Back">
          <IconBack />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-bold leading-tight">{session.name}</p>
          {subtitle && <p className="truncate text-sm text-[color:var(--muted)]">{subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={() => getDiceStore(session.id).setLogOpen(true)}
          className="flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold hover:bg-black/5 dark:hover:bg-white/10"
        >
          <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M8 9h8M8 13h8M8 17h5" /></svg>
          Log
        </button>
        {connection === 'reconnecting' && (
          <span role="status" className="mr-2 flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            <span className="size-2 animate-pulse rounded-full bg-amber-600" aria-hidden="true" />
            Reconnecting…
          </span>
        )}
      </div>
      {tabs && !isGm && (
        <nav className="mx-auto flex max-w-screen-sm px-2" aria-label="Player views">
          <NavLink to={mine ? `/s/${session.id}/c/${mine.id}` : `/s/${session.id}/new-character`} className={tab}>
            My sheet
          </NavLink>
          <NavLink to={`/s/${session.id}/table`} className={tab}>Table</NavLink>
        </nav>
      )}
    </header>
  )
}
