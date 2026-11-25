import { useCallback } from 'react'
import { friendlyError } from '../lib/errors.ts'
import { supabase } from '../lib/supabase.ts'
import { useSession } from '../session/SessionProvider.tsx'
import type { Spotlight } from '../session/types.ts'
import { toast } from '../ui/toast.tsx'

/** Highlights older than this are ignored (SPEC §8.2). */
export const SPOTLIGHT_TTL_MS = 10 * 60 * 1000

export function activeSpotlight(raw: unknown, now = Date.now()): Spotlight | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Spotlight
  if (!s.set_at || now - Date.parse(s.set_at) > SPOTLIGHT_TTL_MS) return null
  return s
}

/** "Bea's mild consequence", "Your high concept", "Scene aspect · Warehouse", "An NPC". */
export function spotlightSubtitle(s: Spotlight, uid: string): string {
  if (s.kind === 'scene_aspect') return s.zone_title ? `Scene aspect · ${s.zone_title}` : 'Scene aspect'
  const what = `${s.label ? s.label.toLowerCase() : s.block_type}${s.block_type === 'consequence' && !/consequence/i.test(s.label) ? ' consequence' : ''}`
  if (s.character_kind === 'pc' && s.owner_id === uid) return `Your ${what}`
  if (!s.character_name) return 'An NPC'
  return `${s.character_name}’s ${what}`
}

/** GM side: toggle the highlight on a block or scene aspect, or clear it. */
export function useSpotlight() {
  const { session, isGm } = useSession()
  const current = activeSpotlight(session.spotlight)

  const call = useCallback(
    async (args: { p_character_id?: string; p_block_id?: string; p_scene_aspect_id?: string }) => {
      const { error } = await supabase.rpc('set_spotlight', { p_session_id: session.id, ...args })
      if (error) toast(friendlyError(error), 'error')
    },
    [session.id],
  )

  const isBlockLit = (characterId: string, blockId: string) =>
    current?.kind === 'block' && current.character_id === characterId && current.block_id === blockId
  const isSceneAspectLit = (id: string) => current?.kind === 'scene_aspect' && current.scene_aspect_id === id

  return {
    enabled: isGm,
    current,
    isBlockLit,
    isSceneAspectLit,
    toggleBlock: (characterId: string, blockId: string) =>
      isBlockLit(characterId, blockId) ? call({}) : call({ p_character_id: characterId, p_block_id: blockId }),
    toggleSceneAspect: (id: string) => (isSceneAspectLit(id) ? call({}) : call({ p_scene_aspect_id: id })),
    clear: () => call({}),
  }
}
