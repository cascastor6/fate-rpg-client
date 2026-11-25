import { useSearchParams } from 'react-router-dom'
import { useSession } from '../session/SessionProvider.tsx'
import { InvitePanel, MembersList, YouPanel } from '../session/SessionWidgets.tsx'
import { Button, Card } from '../ui/primitives.tsx'
import { SessionHeader } from './SessionHeader.tsx'

/** Slice 2 placeholder GM screen: invite + members. The real GM screen lands in Slice 7. */
export default function GmHome() {
  const { members } = useSession()
  const [params, setParams] = useSearchParams()
  const isNew = params.get('new') === '1'
  const players = members.filter((m) => m.role === 'player').length

  return (
    <>
      <SessionHeader subtitle={`GM screen · ${players} player${players === 1 ? '' : 's'}`} />
      <main className="mx-auto grid max-w-screen-lg gap-4 px-4 py-6 lg:grid-cols-2">
        {isNew && (
          <Card className="border-amber-500 lg:col-span-2">
            <h2 className="text-lg font-semibold">Session created</h2>
            <p className="mt-1">
              Your <strong>GM code</strong> is the only way back in as GM, on this device or any other. Make sure it’s
              written down somewhere safe; the app doesn’t store it.
            </p>
            <Button className="mt-3" variant="secondary" onClick={() => setParams({}, { replace: true })}>
              Got it
            </Button>
          </Card>
        )}
        <InvitePanel emphasis={isNew} />
        <MembersList />
        <YouPanel />
      </main>
    </>
  )
}
