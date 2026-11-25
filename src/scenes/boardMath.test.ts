import { describe, expect, it } from 'vitest'
import { BOARD_H, BOARD_W, clampToken, clampZone, clampZoom, fitZoom, initials, toBoard, viewCenter } from './boardMath.ts'

describe('board math', () => {
  it('converts screen deltas to board units', () => {
    expect(toBoard(100, 0.5)).toBe(200)
    expect(toBoard(100, 2)).toBe(50)
  })
  it('keeps zones on the board and at least minimum size', () => {
    expect(clampZone({ x: -50, y: 990, w: 100, h: 50 })).toEqual({ x: 0, y: BOARD_H - 120, w: 160, h: 120 })
    expect(clampZone({ x: 1500, y: 10, w: 300, h: 200 })).toEqual({ x: BOARD_W - 300, y: 10, w: 300, h: 200 })
    expect(clampZone({ x: 0, y: 0, w: 5000, h: 5000 })).toEqual({ x: 0, y: 0, w: BOARD_W, h: BOARD_H })
  })
  it('keeps token centres on the board', () => {
    expect(clampToken({ x: -3, y: 1200.4 })).toEqual({ x: 0, y: BOARD_H })
  })
  it('fits and clamps zoom', () => {
    expect(fitZoom(800, 1000)).toBe(0.5)
    expect(fitZoom(375, 600)).toBe(0.4) // phones: minimum zoom, then pan
    expect(fitZoom(4000, 4000)).toBe(2)
    expect(clampZoom(0.123)).toBe(0.4)
  })
  it('finds the visible centre in board units', () => {
    expect(viewCenter(0, 0, 800, 500, 0.5)).toEqual({ x: 800, y: 500 })
    expect(viewCenter(400, 200, 400, 400, 1)).toEqual({ x: 600, y: 400 })
  })
  it('makes token initials', () => {
    expect(initials('Bea Smith')).toBe('BS')
    expect(initials('thug')).toBe('TH')
    expect(initials('  ')).toBe('?')
  })
})
