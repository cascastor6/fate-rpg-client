/** A row of public.rolls. */
export type RollRow = {
  id: string
  session_id: string
  user_id: string | null
  character_id: string | null
  roller_name: string
  roller_color: string
  is_hidden: boolean
  revealed_at: string | null
  label: string | null
  skill_value: number
  bonus: number
  faces: number[]
  dice_total: number
  total: number
  created_at: string
}

/** What players see of a closed GM roll before it's revealed (from a hidden_roll event). */
export type HiddenRoll = { id: string; roller_name: string; roller_color: string; created_at: string }

export type LogEntry = { kind: 'roll'; roll: RollRow } | { kind: 'hidden'; hidden: HiddenRoll }

export const ROLL_COLUMNS =
  'id,session_id,user_id,character_id,roller_name,roller_color,is_hidden,revealed_at,label,skill_value,bonus,faces,dice_total,total,created_at'
