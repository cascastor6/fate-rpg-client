import { useEffect, useSyncExternalStore } from 'react'
import { getSheetStore } from './store.ts'

/** Subscribe to one character's sheet; (re)loads it on mount. */
export function useSheet(characterId: string) {
  const store = getSheetStore(characterId)
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  useEffect(() => {
    void store.load()
  }, [store])
  return { snapshot, enqueue: store.enqueue.bind(store) }
}
