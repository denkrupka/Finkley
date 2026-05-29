import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { tooltipPosition } from './tour-internals'

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

describe('tooltipPosition', () => {
  let originalWindow: typeof globalThis.window | undefined

  beforeEach(() => {
    originalWindow = globalThis.window
    // mock window dimensions: 1280×800 desktop
    ;(globalThis as unknown as { window: object }).window = {
      innerWidth: 1280,
      innerHeight: 800,
    }
  })

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as unknown as { window?: unknown }).window
    } else {
      ;(globalThis as unknown as { window: object }).window = originalWindow
    }
  })

  it('target=null → возвращает 0/0 без window', () => {
    expect(tooltipPosition(null)).toEqual({ left: 0, top: 0 })
  })

  it('target в верхней половине → tooltip снизу', () => {
    const r = tooltipPosition(rect(500, 100, 100, 40), 420, 280)
    // top = 100 + 40 + 16 = 156
    expect(r.top).toBe(156)
    // left = центр target минус половина tooltip = 550 - 210 = 340
    expect(r.left).toBe(340)
  })

  it('target близко к низу viewport → tooltip сверху', () => {
    // vh=800, target.top=700, tooltip оценочно 280px → снизу не помещается
    const r = tooltipPosition(rect(500, 700, 100, 40), 420, 280)
    // placement=top, top = 700 - 280 - 16 = 404
    expect(r.top).toBe(404)
  })

  it('target далеко слева → tooltip прижимается к левому краю (left=8)', () => {
    const r = tooltipPosition(rect(0, 100, 60, 40), 420, 280)
    // центрирование: 0 + 30 - 210 = -180 → clamp до 8
    expect(r.left).toBe(8)
  })

  it('target далеко справа → tooltip прижимается к правому краю', () => {
    // vw=1280, tooltip=420 → max left = 1280 - 420 - 8 = 852
    const r = tooltipPosition(rect(1240, 100, 40, 40), 420, 280)
    expect(r.left).toBe(852)
  })

  it('target в правом нижнем углу → tooltip сверху + clamp вправо', () => {
    // vh=800, vw=1280, target=(1100, 750, 40, 40)
    // bottom: 750+40+16 = 806 > 792 → placement=top
    // top = 750 - 280 - 16 = 454 (> 8, остаётся 'top')
    // left = 1100 + 20 - 210 = 910 → clamp до max(8, min(852, 910)) = 852
    const r = tooltipPosition(rect(1100, 750, 40, 40), 420, 280)
    expect(r.top).toBe(454)
    expect(r.left).toBe(852)
  })

  it('custom tooltip размеры — центрирование пересчитывается', () => {
    const r = tooltipPosition(rect(500, 100, 100, 40), 200, 150)
    // left = 500 + 50 - 100 = 450
    expect(r.left).toBe(450)
    // top снизу: 100 + 40 + 16 = 156, ok вместится (156 + 150 < 792)
    expect(r.top).toBe(156)
  })
})
