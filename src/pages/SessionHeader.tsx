import { Link, NavLink } from 'react-router-dom'
import { useSession } from '../session/SessionProvider.tsx'
import { colorOf } from '../ui/colors.ts'
import { IconBack } from '../ui/icons.tsx'

/** Sticky header: colour stripe, back link, session name, optional player tabs. */
export function SessionHeader({ subtitle, back = '/', tabs = false }: { subtitle?: string; back?: string; tabs?: boolean }) {
  const { session, me, characters, uid, isGm } = useSession()
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
