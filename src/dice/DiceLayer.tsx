import { useEffect } from 'react'
import { DiceTray } from './DiceTray.tsx'
import { RollDialog } from './RollDialog.tsx'
import { RollFab } from './RollFab.tsx'
import { RollLog } from './RollLog.tsx'
import { useDice } from './useDice.ts'

/** Everything dice-related that floats over every session screen. */
export function DiceLayer() {
  const { store } = useDice()
  useEffect(() => store.ensureLoaded(), [store])
  return (
    <>
      <DiceTray />
      <RollFab />
      <RollDialog />
      <RollLog />
    </>
  )
}
