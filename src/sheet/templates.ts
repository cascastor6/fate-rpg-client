// Starting sheets (SPEC §5.5). Every call generates fresh block ids.

import { newBlockId } from './ids.ts'
import type { LogicalBlock, LogicalSection, SheetJson, StressBox, TemplateId } from './types.ts'

const CORE_SKILLS = [
  'Athletics', 'Burglary', 'Contacts', 'Crafts', 'Deceive', 'Drive', 'Empathy', 'Fight', 'Investigate',
  'Lore', 'Notice', 'Physique', 'Provoke', 'Rapport', 'Resources', 'Shoot', 'Stealth', 'Will',
]
const CONDENSED_SKILLS = ['Academics', ...CORE_SKILLS]
const APPROACHES = ['Careful', 'Clever', 'Flashy', 'Forceful', 'Quick', 'Sneaky']

const S = {
  aspects: { id: 's_aspects', title: 'Aspects' },
  approaches: { id: 's_approaches', title: 'Approaches' },
  skills: { id: 's_skills', title: 'Skills' },
  stunts: { id: 's_stunts', title: 'Stunts' },
  stress: { id: 's_stress', title: 'Stress' },
  conseq: { id: 's_conseq', title: 'Consequences' },
  extras: { id: 's_extras', title: 'Extras' },
  notes: { id: 's_notes', title: 'Notes' },
} satisfies Record<string, LogicalSection>

const aspect = (label: string, role: 'high_concept' | 'trouble' | 'other' = 'other'): LogicalBlock =>
  ({ id: newBlockId(), type: 'aspect', label, value: '', section: S.aspects.id, role })

const standardAspects = () => [
  aspect('High Concept', 'high_concept'), aspect('Trouble', 'trouble'),
  aspect('Aspect'), aspect('Aspect'), aspect('Aspect'),
]

const skill = (label: string, section: string): LogicalBlock =>
  ({ id: newBlockId(), type: 'skill', label, value: 0, section, rollable: true })

const boxes = (sizes: number[], enabled: number): StressBox[] =>
  sizes.map((size, i) => (i < enabled ? { size, checked: false } : { size, checked: false, disabled: true }))

const stress = (label: string, value: StressBox[]): LogicalBlock =>
  ({ id: newBlockId(), type: 'stress', label, value, section: S.stress.id })

const consequence = (label: string, shift: number, hint?: string): LogicalBlock =>
  ({ id: newBlockId(), type: 'consequence', label, value: '', section: S.conseq.id, shift, ...(hint ? { hint } : {}) })

const standardConsequences = () => [consequence('Mild', 2), consequence('Moderate', 4), consequence('Severe', 6)]

const text = (label: string, section: string, hint?: string): LogicalBlock =>
  ({ id: newBlockId(), type: 'text', label, value: '', section, multiline: true, ...(hint ? { hint } : {}) })

const stunts = () => [1, 2, 3].map(() => text('Stunt', S.stunts.id, 'Because I…, I get +2 when I…'))

export const TEMPLATES: { id: Exclude<TemplateId, 'npc'>; name: string; blurb: string }[] = [
  { id: 'core', name: 'Fate Core', blurb: '18 skills, 2 stress tracks, 3 consequences' },
  { id: 'accelerated', name: 'Fate Accelerated', blurb: '6 approaches, one stress track' },
  { id: 'condensed', name: 'Fate Condensed', blurb: '19 skills, 1-point stress boxes' },
  { id: 'blank', name: 'Blank', blurb: 'Start from nothing and build your own' },
]

export function buildTemplate(template: TemplateId, name: string): SheetJson {
  const base = { format: 'fate-table-sheet', version: 1, kind: 'pc', name, template, fate_points: 3, refresh: 3 } as const
  switch (template) {
    case 'core':
      return {
        ...base,
        sections: [S.aspects, S.skills, S.stunts, S.stress, S.conseq, S.extras, S.notes],
        blocks: [
          ...standardAspects(),
          ...CORE_SKILLS.map((s) => skill(s, S.skills.id)),
          ...stunts(),
          stress('Physical', boxes([1, 2, 3, 4], 2)),
          stress('Mental', boxes([1, 2, 3, 4], 2)),
          ...standardConsequences(),
          consequence('Mild (extra)', 2, 'Unlocked by Superb (+5) Physique or Will'),
          text('Extras', S.extras.id),
          text('Notes', S.notes.id),
        ],
      }
    case 'accelerated':
      return {
        ...base,
        sections: [S.aspects, S.approaches, S.stunts, S.stress, S.conseq, S.notes],
        blocks: [
          ...standardAspects(),
          ...APPROACHES.map((s) => skill(s, S.approaches.id)),
          ...stunts(),
          stress('Stress', boxes([1, 2, 3], 3)),
          ...standardConsequences(),
          text('Notes', S.notes.id),
        ],
      }
    case 'condensed':
      return {
        ...base,
        sections: [S.aspects, S.skills, S.stunts, S.stress, S.conseq, S.notes],
        blocks: [
          ...standardAspects(),
          ...CONDENSED_SKILLS.map((s) => skill(s, S.skills.id)),
          ...stunts(),
          stress('Physical', boxes([1, 1, 1, 1, 1, 1], 3)),
          stress('Mental', boxes([1, 1, 1, 1, 1, 1], 3)),
          ...standardConsequences(),
          text('Notes', S.notes.id),
        ],
      }
    case 'blank':
      return { ...base, sections: [S.aspects, S.notes], blocks: [] }
    case 'npc':
      return {
        ...base,
        kind: 'npc',
        fate_points: 0,
        refresh: 0,
        sections: [S.aspects, S.skills],
        blocks: [aspect('Aspect'), aspect('Aspect'), skill('', S.skills.id), skill('', S.skills.id)],
      }
  }
}
