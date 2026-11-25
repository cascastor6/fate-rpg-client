import type { ReactNode } from 'react'
import { Navigate, Outlet, useParams } from 'react-router-dom'
import { DiceLayer } from '../dice/DiceLayer.tsx'
import { SpotlightPopup } from '../gm/SpotlightPopup.tsx'
import { SessionProvider, useSession } from '../session/SessionProvider.tsx'

/** /s/:sessionId — loads the session (or bounces home) for everything below it. */
export default function SessionLayout() {
  const { sessionId } = useParams()
  if (!sessionId) return <Navigate to="/" replace />
  return (
    <SessionProvider key={sessionId} sessionId={sessionId}>
      <Outlet />
      <DiceLayer />
      <SpotlightPopup />
    </SessionProvider>
  )
}

/** /s/:sessionId — GM to the GM screen; players to their sheet, or to character creation. */
export function SessionIndex() {
  const { isGm, characters, uid } = useSession()
  if (isGm) return <Navigate to="gm" replace />
  const mine = characters.find((c) => c.kind === 'pc' && c.owner_id === uid)
  return <Navigate to={mine ? `c/${mine.id}` : 'new-character'} replace />
}

/** Only GMs may see the wrapped route; players go back to /s/:id. */
export function GmOnly({ children }: { children: ReactNode }) {
  const { isGm, session } = useSession()
  return isGm ? <>{children}</> : <Navigate to={`/s/${session.id}`} replace />
}
