import { useSyncExternalStore } from 'react'
import { readJson, writeJson } from './storage.ts'

// Light / dark / system (SPEC §12). Stored per device; "system" follows the OS.

export type ThemePref = 'system' | 'light' | 'dark'
const KEY = 'fate.theme'
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null
const listeners = new Set<() => void>()

let pref: ThemePref = (() => {
  const v = readJson<ThemePref>(KEY)
  return v === 'light' || v === 'dark' ? v : 'system'
})()

export function isDark(p: ThemePref = pref): boolean {
  return p === 'dark' || (p === 'system' && !!media?.matches)
}

function apply() {
  const dark = isDark()
  document.documentElement.classList.toggle('dark', dark)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#171412' : '#faf7f2')
  listeners.forEach((l) => l())
}

export function initTheme() {
  apply()
  media?.addEventListener('change', () => pref === 'system' && apply())
}

export function setTheme(p: ThemePref) {
  pref = p
  writeJson(KEY, p)
  apply()
}

export function useTheme(): ThemePref {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => void listeners.delete(fn) }, () => pref)
}
