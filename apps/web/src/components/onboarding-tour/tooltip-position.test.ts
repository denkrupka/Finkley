import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { tooltipPosition } from './tour-internals'

const ORIGINAL_INNER_WIDTH = globalThis.window?.innerWidth
const ORIGINAL_INNER_HEIGHT = globalThis.window?.innerHeight

function setViewport(w: number, h: number) {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true })
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true, writable: true })
}

function rect(top: number, left: number, width: number, height: number): DOMRect {
  return {
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON() {
      return this
    },
  }
}

beforeEach(() => {
  setViewport(1440, 900)
})

afterEach(() => {
  if (ORIGINAL_INNER_WIDTH != null) setViewport(ORIGINAL_INNER_WIDTH, ORIGINAL_INNER_HEIGHT ?? 768)
})

describe('tooltipPosition', () => {
  it('null target → {0, 0}', () => {
    expect(tooltipPosition(null)).toEqual({ left: 0, top: 0 })
  })

  it('размещает снизу target когда достаточно места', () => {
    const r = rect(100, 600, 200, 50) // target в верхней части viewport
    const p = tooltipPosition(r)
    // tooltip ниже target: top = 100 + 50 + 16 = 166
    expect(p.top).toBe(166)
    // центрируется по горизонтали: 600 + 100 - 210 = 490
    expect(p.left).toBe(490)
  })

  it('размещает сверху если внизу не помещается', () => {
    setViewport(1440, 400)
    const r = rect(300, 600, 200, 50) // target в нижней части
    const p = tooltipPosition(r)
    // top = 300 - 280 - 16 = 4 → не помещается сверху → fallback на right
    // (placement='right' выставит top=Math.max(8, ...))
    expect(p.top).toBeGreaterThanOrEqual(8)
  })

  it('clamp слева к viewport: 8px минимум', () => {
    const r = rect(100, 0, 50, 30) // target у самого левого края
    const p = tooltipPosition(r)
    // centered = 0 + 25 - 210 = -185 → clamp к 8
    expect(p.left).toBe(8)
  })

  it('clamp справа к viewport: vw - tooltipW - 8', () => {
    const r = rect(100, 1400, 30, 30) // target у правого края viewport
    const p = tooltipPosition(r)
    // centered = 1400 + 15 - 210 = 1205, max = 1440 - 420 - 8 = 1012 → clamp
    expect(p.left).toBe(1012)
  })

  it('кастомные размеры tooltip', () => {
    const r = rect(100, 600, 200, 50)
    const p = tooltipPosition(r, 320, 200)
    // центрируется по новой ширине: 600 + 100 - 160 = 540
    expect(p.left).toBe(540)
    // top тот же расчёт
    expect(p.top).toBe(166)
  })

  it('SSR-safe: если window undefined — возвращает {0,0}', () => {
    // Имитируем SSR — temporarily убираем window
    const w = globalThis.window
    // @ts-expect-error — намеренная проверка SSR fallback
    delete globalThis.window
    try {
      expect(tooltipPosition(rect(100, 100, 50, 50))).toEqual({ left: 0, top: 0 })
    } finally {
      globalThis.window = w
    }
  })
})
