import type { PlayerColor } from '../ui/colors.ts'

export type Role = 'gm' | 'player'

export type SessionRow = {
  id: string
  name: string
  invite_code: string
  gm_fate_points: number
  gm_roll_mode: 'open' | 'closed'
  active_scene_id: string | null
  spotlight: unknown
  version: number
}

export type Member = {
  session_id: string
  user_id: string
  role: Role
  display_name: string
  color: PlayerColor
  joined_at: string
}

/** A row of public.scene_aspects (SPEC §4.1). */
export type SceneAspectRow = {
  id: string
  scene_id: string
  session_id: string
  zone_id: string | null
  text: string
  free_invokes: number
  position: number
  version: number
}

export const SCENE_ASPECT_COLUMNS = 'id,scene_id,session_id,zone_id,text,free_invokes,position,version'

/** sessions.spotlight, as written by set_spotlight (SPEC §8.2). */
export type Spotlight =
  | {
      kind: 'block'
      character_id: string
      block_id: string
      block_type: 'aspect' | 'consequence'
      label: string
      text: string
      free_invokes?: number
      character_kind: 'pc' | 'npc'
      owner_id?: string
      /** omitted for hidden NPCs */
      character_name?: string
      set_at: string
      by: string
    }
  | {
      kind: 'scene_aspect'
      scene_aspect_id: string
      text: string
      free_invokes?: number
      zone_title?: string
      set_at: string
      by: string
    }
