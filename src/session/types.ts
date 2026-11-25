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
