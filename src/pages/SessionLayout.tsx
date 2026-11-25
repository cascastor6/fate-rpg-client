import type { ReactNode } from 'react'
import { Navigate, Outlet, useParams } from 'react-router-dom'
import { SessionProvider, useSession } from '../session/SessionProvider.tsx'

/** /s/:sessionId — loads the session (or bounces home) for everything below it. */
export default function SessionLayout() {
  const { sessionId } = useParams()
  if (!sessionId) return <Navigate to="/" replace />
  return (
    <SessionProvider key={sessionId} sessionId={sessionId}>
      <Outlet />
    </SessionProvider>
  )
}

/** /s/:sessionId — send the GM to the GM screen; players stay here. */
export function SessionIndex({ player }: { player: ReactNode }) {
  const { isGm } = useSession()
  return isGm ? <Navigate to="gm" replace /> : <>{player}</>
}

/** Only GMs may see the wrapped route; players go back to /s/:id. */
export function GmOnly({ children }: { children: ReactNode }) {
  const { isGm, session } = useSession()
  return isGm ? <>{children}</> : <Navigate to={`/s/${session.id}`} replace />
}
