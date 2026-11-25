import { useSession } from '../session/SessionProvider.tsx'
import { MembersList, YouPanel } from '../session/SessionWidgets.tsx'
import { Card } from '../ui/primitives.tsx'
import { SessionHeader } from './SessionHeader.tsx'

/** Slice 2 placeholder player screen. The character sheet replaces it in Slice 3. */
export default function PlayerHome() {
  const { me } = useSession()
  return (
    <>
      <SessionHeader subtitle={`Playing as ${me.display_name}`} />
      <main className="mx-auto flex max-w-screen-sm flex-col gap-4 px-4 py-6">
        <Card>
          <h2 className="text-lg font-semibold">You’re in!</h2>
          <p className="mt-1 text-sm text-[color:var(--muted)]">
            Character sheets arrive in the next slice. Reopening the app brings you straight back here.
          </p>
        </Card>
        <MembersList />
        <YouPanel />
      </main>
    </>
  )
}
