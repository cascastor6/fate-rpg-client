// One realtime channel per session (SPEC §10). INSERT/UPDATE are filtered by session
// and RLS-checked by Supabase; DELETE can't be filtered and only carries primary keys,
// so deletes arrive for every session and callers ignore keys they don't hold.

import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase.ts'
import type { ChangeType } from '../sheet/remote.ts'

export const SESSION_TABLES = ['session_members', 'characters', 'sheet_sections', 'sheet_blocks', 'rolls', 'scenes', 'scene_aspects', 'session_events'] as const
export type SessionTable = (typeof SESSION_TABLES)[number] | 'sessions'

export type Change = { table: SessionTable; type: ChangeType; row: Record<string, unknown> }
export type ConnectionState = 'connecting' | 'live' | 'reconnecting'

export function openSessionChannel(
  sessionId: string,
  handlers: {
    onChange: (c: Change) => void
    /** after a reconnect: refetch whatever may have been missed */
    onResync: () => void
    onState: (s: ConnectionState) => void
  },
): () => void {
  let everSubscribed = false
  const channel: RealtimeChannel = supabase.channel(`session:${sessionId}`)

  const forward = (table: SessionTable) => (payload: { eventType: ChangeType; new: Record<string, unknown>; old: Record<string, unknown> }) =>
    handlers.onChange({ table, type: payload.eventType, row: payload.eventType === 'DELETE' ? payload.old : payload.new })

  channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` }, forward('sessions'))
  for (const table of SESSION_TABLES) {
    for (const event of ['INSERT', 'UPDATE'] as const) {
      channel.on('postgres_changes', { event, schema: 'public', table, filter: `session_id=eq.${sessionId}` }, forward(table))
    }
    channel.on('postgres_changes', { event: 'DELETE', schema: 'public', table }, forward(table))
  }

  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      handlers.onState('live')
      if (everSubscribed) handlers.onResync()
      everSubscribed = true
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      handlers.onState(everSubscribed ? 'reconnecting' : 'connecting')
    }
  })

  return () => {
    void supabase.removeChannel(channel)
  }
}
