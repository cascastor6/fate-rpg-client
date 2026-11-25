import { Link, useSearchParams } from 'react-router-dom'
import { useSession } from '../session/SessionProvider.tsx'
import { InvitePanel, MembersList, YouPanel } from '../session/SessionWidgets.tsx'
import { colorOf } from '../ui/colors.ts'
import { Button, Card } from '../ui/primitives.tsx'
import { SessionHeader } from './SessionHeader.tsx'
import { GmRollsCard } from './GmRollsCard.tsx'
import { TemplatesCard } from './TemplatesCard.tsx'

/** Slice 2 placeholder GM screen: invite + members. The real GM screen lands in Slice 7. */
export default function GmHome() {
  const { members, characters, session } = useSession()
  const [params, setParams] = useSearchParams()
  const isNew = params.get('new') === '1'
  const players = members.filter((m) => m.role === 'player').length
  const people = characters.filter((c) => c.kind !== 'template')

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
        <Card>
          <h2 className="text-lg font-semibold">Characters</h2>
          {people.length === 0 ? (
            <p className="mt-2 text-sm text-[color:var(--muted)]">No characters yet. Players create theirs when they join.</p>
          ) : (
            <ul className="mt-2 flex flex-col">
              {people.map((c) => {
                const owner = members.find((m) => m.user_id === c.owner_id)
                const color = colorOf(owner?.color)
                return (
                  <li key={c.id}>
                    <Link to={`/s/${session.id}/c/${c.id}`} className="flex min-h-12 items-center gap-3 rounded-xl px-2 hover:bg-black/5 dark:hover:bg-white/5">
                      <span className="size-3 rounded-full" style={{ background: color.fill }} aria-hidden="true" />
                      <span className="flex-1 truncate font-medium">{c.name}</span>
                      <span className="text-sm text-[color:var(--muted)]">{c.kind === 'npc' ? 'NPC' : owner?.display_name ?? 'No player'}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
        <GmRollsCard />
        <TemplatesCard />
        <MembersList />
        <YouPanel />
      </main>
    </>
  )
}
