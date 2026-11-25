// Zones board geometry (SPEC §8.3.3). Everything is stored in board units on a fixed
// 1600 × 1000 canvas, so the layout is identical on every screen; the view just scales.

export const BOARD_W = 1600
export const BOARD_H = 1000
export const ZONE_MIN_W = 160
export const ZONE_MIN_H = 120
export const ZONE_DEFAULT = { w: 360, h: 240 }
export const TOKEN_SIZE = 56
export const ZOOM_MIN = 0.4
export const ZOOM_MAX = 2

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
export const clampZoom = (z: number) => clamp(Math.round(z * 100) / 100, ZOOM_MIN, ZOOM_MAX)

/** Screen pixels → board units at a zoom level. */
export const toBoard = (px: number, zoom: number) => px / zoom

/** Keep a zone fully on the board. */
export function clampZone(z: { x: number; y: number; w: number; h: number }) {
  const w = clamp(Math.round(z.w), ZONE_MIN_W, BOARD_W)
  const h = clamp(Math.round(z.h), ZONE_MIN_H, BOARD_H)
  return { w, h, x: clamp(Math.round(z.x), 0, BOARD_W - w), y: clamp(Math.round(z.y), 0, BOARD_H - h) }
}

/** Keep a token's centre on the board. */
export function clampToken(t: { x: number; y: number }) {
  return { x: clamp(Math.round(t.x), 0, BOARD_W), y: clamp(Math.round(t.y), 0, BOARD_H) }
}

/** Zoom that fits the whole board in a viewport. */
export function fitZoom(viewW: number, viewH: number): number {
  if (viewW <= 0 || viewH <= 0) return 1
  return clampZoom(Math.min(viewW / BOARD_W, viewH / BOARD_H))
}

/** Board point at the centre of what's visible (for placing new things). */
export function viewCenter(scrollLeft: number, scrollTop: number, viewW: number, viewH: number, zoom: number) {
  return clampToken({ x: (scrollLeft + viewW / 2) / zoom, y: (scrollTop + viewH / 2) / zoom })
}

/** Initials for a token: "Bea Smith" → "BS", "thug" → "TH". */
export function initials(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}
