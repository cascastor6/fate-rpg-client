import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { NpcRoster } from '../npcs/NpcRoster.tsx'
import { SceneEditor } from '../scenes/SceneEditor.tsx'
import { SceneList } from '../scenes/SceneList.tsx'
import { useScenes } from '../scenes/store.ts'
import { useSession } from '../session/SessionProvider.tsx'
import { Spinner } from '../ui/primitives.tsx'
import { useMedia } from './useMedia.ts'

/**
 * Scenes & NPCs (SPEC §8.3). Desktop: scene list | editor | NPC roster.
 * Phone: Scene / NPCs switch, with a scene picker.
 */
export default function ScenesTab() {
  const { session } = useSession()
  const { store, scenes, loaded } = useScenes(session.id)
  const [params, setParams] = useSearchParams()
  const desktop = useMedia('(min-width: 1024px)')
  const [pane, setPane] = useState<'scene' | 'npcs'>('scene')

  useEffect(() => { if (!loaded) void store.load() }, [store, loaded])

  const selectedId = params.get('scene') ?? session.active_scene_id ?? scenes[0]?.id ?? null
  const scene = scenes.find((s) => s.id === selectedId) ?? scenes[0] ?? null
  const select = (id: string) => setParams({ scene: id }, { replace: true })
  const boardScene = scene?.kind === 'zones' ? scene : null

  if (!loaded) return <div className="flex justify-center py-10"><Spinner className="size-6" /></div>

  const editor = scene
    ? <SceneEditor key={scene.id} scene={scene} onDeleted={() => setParams({}, { replace: true })} />
    : <p className="rounded-2xl border border-dashed border-[color:var(--border)] p-6 text-center text-[color:var(--muted)]">No scenes yet. Create one.</p>

  if (desktop) {
    return (
      <main id="main" tabIndex={-1} className="mx-auto grid max-w-[110rem] grid-cols-[15rem_minmax(0,1fr)_22rem] items-start gap-4 px-4 pb-28">
        <SceneList selected={scene?.id ?? null} onSelect={select} />
        <section aria-label="Scene editor">{editor}</section>
        <aside className="max-h-[calc(100dvh-10rem)] overflow-y-auto pr-1"><NpcRoster boardScene={boardScene} /></aside>
      </main>
    )
  }
  return (
    <main id="main" tabIndex={-1} className="mx-auto flex max-w-screen-sm flex-col gap-3 px-3 pb-28">
      <div className="flex rounded-xl border border-[color:var(--border)] p-1" role="tablist">
        {(['scene', 'npcs'] as const).map((p) => (
          <button key={p} type="button" role="tab" aria-selected={pane === p} onClick={() => setPane(p)}
            className={`min-h-11 flex-1 rounded-lg text-sm font-semibold ${pane === p ? 'bg-amber-700 text-white' : ''}`}>
            {p === 'scene' ? 'Scene' : 'NPCs'}
          </button>
        ))}
      </div>
      {pane === 'scene' ? (
        <>
          <label className="flex items-center gap-2">
            <span className="text-sm font-medium">Scene</span>
            <select value={scene?.id ?? ''} onChange={(e) => select(e.target.value)} aria-label="Pick a scene"
              className="min-h-11 flex-1 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg)] px-2">
              {scenes.map((s) => <option key={s.id} value={s.id}>{s.name}{s.id === session.active_scene_id ? ' (live)' : ''}</option>)}
            </select>
          </label>
          <details>
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">Manage scenes</summary>
            <SceneList selected={scene?.id ?? null} onSelect={select} />
          </details>
          {editor}
        </>
      ) : (
        <NpcRoster boardScene={boardScene} />
      )}
    </main>
  )
}
