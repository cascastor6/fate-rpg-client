import { Link } from 'react-router-dom'
import { useSession } from '../session/SessionProvider.tsx'
import { colorOf } from '../ui/colors.ts'
import { Card } from '../ui/primitives.tsx'
import { SessionHeader } from './SessionHeader.tsx'

/** /s/:id/table — everyone's characters; others' sheets open read-only (SPEC §9.1). */
export default function TablePage() {
  const { session, characters, members, uid } = useSession()
  const pcs = characters.filter((c) => c.kind === 'pc')
  const npcs = characters.filter((c) => c.kind === 'npc')

  const row = (c: (typeof characters)[number]) => {
    const owner = members.find((m) => m.user_id === c.owner_id)
    const color = colorOf(c.kind === 'npc' ? 'slate' : owner?.color)
    return (
      <li key={c.id}>
        <Link
          to={`/s/${session.id}/c/${c.id}`}
          className="flex min-h-14 items-center gap-3 rounded-xl px-3 hover:bg-black/5 dark:hover:bg-white/5"
        >
          <span
            className="flex size-10 shrink-0 items-center justify-center rounded-full font-bold"
            style={{ background: color.fill, color: color.ink }}
            aria-hidden="true"
          >
            {c.name.charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{c.name}</span>
            <span className="block truncate text-sm text-[color:var(--muted)]">
              {c.kind === 'npc' ? 'NPC' : c.owner_id === uid ? 'You' : owner ? owner.display_name : 'No player'}
            </span>
          </span>
          <span className="text-[color:var(--muted)]" aria-hidden="true">›</span>
        </Link>
      </li>
    )
  }

  return (
    <>
      <SessionHeader tabs />
      <main className="mx-auto flex max-w-screen-sm flex-col gap-4 px-4 py-6">
        <Card>
          <h1 className="text-lg font-semibold">Characters</h1>
          {pcs.length ? <ul className="mt-2 flex flex-col">{pcs.map(row)}</ul> : (
            <p className="mt-2 text-sm text-[color:var(--muted)]">No one has made a character yet.</p>
          )}
        </Card>
        {npcs.length > 0 && (
          <Card>
            <h2 className="text-lg font-semibold">NPCs</h2>
            <ul className="mt-2 flex flex-col">{npcs.map(row)}</ul>
          </Card>
        )}
      </main>
    </>
  )
}
