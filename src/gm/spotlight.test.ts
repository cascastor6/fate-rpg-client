import { describe, expect, it } from 'vitest'
import type { Spotlight } from '../session/types.ts'
import { activeSpotlight, spotlightSubtitle } from './spotlight.ts'

const block = (o: Partial<Extract<Spotlight, { kind: 'block' }>>): Spotlight => ({
  kind: 'block', character_id: 'c', block_id: 'b', block_type: 'aspect', label: 'High Concept', text: 'Knight',
  character_kind: 'pc', owner_id: 'u1', character_name: 'Aldric', set_at: new Date().toISOString(), by: 'gm', ...o,
})

describe('spotlight', () => {
  it('describes whose item it is', () => {
    expect(spotlightSubtitle(block({}), 'u1')).toBe('Your high concept')
    expect(spotlightSubtitle(block({}), 'u2')).toBe('Aldric’s high concept')
    expect(spotlightSubtitle(block({ block_type: 'consequence', label: 'Mild' }), 'u2')).toBe('Aldric’s mild consequence')
    expect(spotlightSubtitle(block({ character_kind: 'npc', owner_id: undefined, character_name: undefined }), 'u2')).toBe('An NPC')
    expect(spotlightSubtitle({ kind: 'scene_aspect', scene_aspect_id: 'a', text: 'On Fire', zone_title: 'Warehouse', set_at: '', by: '' }, 'u')).toBe('Scene aspect · Warehouse')
  })
  it('ignores missing and stale highlights', () => {
    expect(activeSpotlight(null)).toBeNull()
    const now = Date.parse('2026-11-25T12:00:00Z')
    expect(activeSpotlight(block({ set_at: '2026-11-25T11:55:00Z' }), now)).not.toBeNull()
    expect(activeSpotlight(block({ set_at: '2026-11-25T11:49:00Z' }), now)).toBeNull()
  })
})
