import { useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { TemplatesCard } from '../pages/TemplatesCard.tsx'
import { useSession } from '../session/SessionProvider.tsx'
import { InvitePanel } from '../session/SessionWidgets.tsx'
import { colorOf } from '../ui/colors.ts'
import { Button, Card } from '../ui/primitives.tsx'
import { CharacterCard } from './CharacterCard.tsx'
import { SceneStrip } from './SceneStrip.tsx'
import { useMedia } from './useMedia.ts'

/** GM Players tab (SPEC §8.1): grid of PC cards on desktop, swipeable cards on phones. */
export default function PlayersTab() {
  const { characters, members } = useSession()
  const [params, setParams] = useSearchParams()
  const isNew = params.get('new') === '1'
  const desktop = useMedia('(min-width: 1024px)')
  const pcs = characters.filter((c) => c.kind === 'pc')

  return (
    <main className="mx-auto flex max-w-screen-xl flex-col gap-4 px-4 pb-28">
      {isNew && (
        <Card className="border-amber-500">
          <h2 className="text-lg font-semibold">Session created</h2>
          <p className="mt-1">
            Your <strong>GM code</strong> is the only way back in as GM, on this device or any other. Make sure it’s written down; the app doesn’t store it.
          </p>
          <Button className="mt-3" variant="secondary" onClick={() => setParams({}, { replace: true })}>Got it</Button>
        </Card>
      )}
      <SceneStrip />
      {pcs.length === 0 ? (
        <>
          <p className="text-[color:var(--muted)]">No player characters yet. Players create theirs when they join.</p>
          <InvitePanel emphasis />
        </>
      ) : desktop ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] items-start gap-4">
          {pcs.map((c) => <CharacterCard key={c.id} character={c} />)}
        </div>
      ) : (
        <Pager ids={pcs.map((c) => c.id)} labels={pcs.map((c) => {
          const o = members.find((m) => m.user_id === c.owner_id)
          return { name: c.name, color: colorOf(o?.color).fill }
        })}>
          {pcs.map((c) => <CharacterCard key={c.id} character={c} />)}
        </Pager>
      )}
      <TemplatesCard />
    </main>
  )
}

/** Horizontal scroll-snap pager with name chips and dots (no library). */
function Pager({ ids, labels, children }: { ids: string[]; labels: { name: string; color: string }[]; children: React.ReactNode[] }) {
  const track = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)
  const go = (i: number) => track.current?.children[i]?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' })
  return (
    <section aria-label="Player cards" aria-roledescription="carousel">
      <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
        {labels.map((l, i) => (
          <button key={ids[i]} type="button" onClick={() => go(i)} aria-current={i === index}
            className={`min-h-9 shrink-0 rounded-full border-2 px-3 text-sm font-semibold ${i === index ? 'text-white' : ''}`}
            style={{ borderColor: l.color, background: i === index ? l.color : undefined }}>
            {l.name}
          </button>
        ))}
      </div>
      <div
        ref={track}
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-2 [scrollbar-width:none]"
        onScroll={(e) => {
          const el = e.currentTarget
          setIndex(Math.round(el.scrollLeft / (el.clientWidth - 20)))
        }}
      >
        {children.map((child, i) => (
          <div key={ids[i]} className="w-[calc(100%-1.5rem)] shrink-0 snap-start" aria-roledescription="slide" aria-label={`${i + 1} of ${ids.length}`}>
            {child}
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-center gap-1.5" aria-hidden="true">
        {ids.map((id, i) => <span key={id} className={`size-2 rounded-full ${i === index ? 'bg-[color:var(--fg)]' : 'bg-black/20 dark:bg-white/25'}`} />)}
      </div>
    </section>
  )
}
