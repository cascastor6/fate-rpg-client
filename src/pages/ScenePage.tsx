import { useEffect } from 'react'
import { activeSpotlight } from '../gm/spotlight.ts'
import { NarrativeScene } from '../scenes/NarrativeScene.tsx'
import { useScenes } from '../scenes/store.ts'
import { ZonesBoard } from '../scenes/ZonesBoard.tsx'
import { useSession } from '../session/SessionProvider.tsx'
import { Spinner } from '../ui/primitives.tsx'
import { SessionHeader } from './SessionHeader.tsx'

/** Player Scene tab (SPEC §8.3.4): the active scene, read-only. */
export default function ScenePage() {
  const { session } = useSession()
  const { store, scenes, contents, loaded } = useScenes(session.id)
  const activeId = session.active_scene_id
  const scene = scenes.find((s) => s.id === activeId)

  // The scene list (RLS: just the active one) follows the session's active scene.
  useEffect(() => { void store.load() }, [store, activeId])
  useEffect(() => { if (activeId) void store.loadScene(activeId) }, [store, activeId])

  const c = activeId ? contents[activeId] : undefined
  const lit = activeSpotlight(session.spotlight)
  return (
    <>
      <SessionHeader tabs />
      <main className="mx-auto flex max-w-screen-lg flex-col gap-3 px-3 pt-4 pb-28">
        {!activeId ? (
          <p className="rounded-2xl border border-dashed border-[color:var(--border)] p-8 text-center text-[color:var(--muted)]">
            The GM hasn’t shared a scene yet.
          </p>
        ) : !loaded || !scene || !c ? (
          <div className="flex justify-center py-10"><Spinner className="size-6" /></div>
        ) : (
          <>
            <h1 className="px-1 text-2xl font-bold">{scene.name}</h1>
            {scene.kind === 'narrative'
              ? <NarrativeScene sceneId={scene.id} contents={c}
                  spot={undefined} />
              : <ZonesBoard contents={c} />}
            {lit?.kind === 'scene_aspect' && <p className="sr-only">Highlighted: {lit.text}</p>}
          </>
        )}
      </main>
    </>
  )
}
