import { useSyncExternalStore } from 'react'

// How many modal layers (bottom sheets, drawers) are open, and whether a drag is in
// progress. The floating roll button hides while either is true (SPEC §7.5).

let open = 0
let busy = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export const overlays = {
  opened() { open++; emit() },
  closed() { open = Math.max(0, open - 1); emit() },
  setBusy(b: boolean) { busy = b; emit() },
}

export function useOverlayOpen(): boolean {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => void listeners.delete(fn) },
    () => open > 0 || busy,
  )
}
