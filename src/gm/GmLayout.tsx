import { NavLink, Outlet } from 'react-router-dom'
import { SessionHeader } from '../pages/SessionHeader.tsx'
import { useSession } from '../session/SessionProvider.tsx'
import { GmToolbar } from './GmToolbar.tsx'

/** GM screen (SPEC §8): two tabs sharing one toolbar. */
export default function GmLayout() {
  const { session, members } = useSession()
  const players = members.filter((m) => m.role === 'player').length
  const tab = ({ isActive }: { isActive: boolean }) =>
    `flex min-h-11 items-center border-b-2 px-4 text-sm font-semibold ${
      isActive ? 'border-amber-700 text-[color:var(--fg)]' : 'border-transparent text-[color:var(--muted)]'
    }`
  return (
    <>
      <SessionHeader subtitle={`GM screen · ${players} player${players === 1 ? '' : 's'}`} />
      <div className="border-b border-[color:var(--border)]">
        <nav className="mx-auto flex max-w-screen-xl px-2" aria-label="GM views">
          <NavLink end to={`/s/${session.id}/gm`} className={tab}>Players</NavLink>
          <NavLink to={`/s/${session.id}/gm/scenes`} className={tab}>Scenes &amp; NPCs</NavLink>
        </nav>
      </div>
      <GmToolbar />
      <Outlet />
    </>
  )
}
