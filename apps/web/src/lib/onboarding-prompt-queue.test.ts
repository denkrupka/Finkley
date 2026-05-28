import { describe, expect, it } from 'vitest'

import { parsePromptQueue, serializePromptQueue, shiftPromptQueue } from './onboarding-prompt-queue'

describe('parsePromptQueue (T201)', () => {
  it('null/undefined → empty array', () => {
    expect(parsePromptQueue(null)).toEqual([])
    expect(parsePromptQueue(undefined)).toEqual([])
    expect(parsePromptQueue('')).toEqual([])
  })

  it('single provider', () => {
    expect(parsePromptQueue('booksy')).toEqual(['booksy'])
  })

  it('multiple providers comma-separated', () => {
    expect(parsePromptQueue('booksy,wfirma,ksef')).toEqual(['booksy', 'wfirma', 'ksef'])
  })

  it('trims whitespace', () => {
    expect(parsePromptQueue('  booksy , wfirma  ')).toEqual(['booksy', 'wfirma'])
  })

  it('filters empty entries', () => {
    expect(parsePromptQueue('booksy,,wfirma,')).toEqual(['booksy', 'wfirma'])
  })
})

describe('shiftPromptQueue (T201)', () => {
  it('empty queue → head null, rest empty', () => {
    expect(shiftPromptQueue([])).toEqual({ head: null, rest: [] })
  })

  it('one item → head + empty rest', () => {
    expect(shiftPromptQueue(['booksy'])).toEqual({ head: 'booksy', rest: [] })
  })

  it('multiple → head + tail', () => {
    expect(shiftPromptQueue(['booksy', 'wfirma', 'ksef'])).toEqual({
      head: 'booksy',
      rest: ['wfirma', 'ksef'],
    })
  })

  it('does not mutate input', () => {
    const input = ['a', 'b', 'c']
    shiftPromptQueue(input)
    expect(input).toEqual(['a', 'b', 'c'])
  })
})

describe('serializePromptQueue (T201)', () => {
  it('empty → null (clear URL param)', () => {
    expect(serializePromptQueue([])).toBeNull()
  })

  it('single', () => {
    expect(serializePromptQueue(['booksy'])).toBe('booksy')
  })

  it('multiple → comma-joined', () => {
    expect(serializePromptQueue(['booksy', 'wfirma'])).toBe('booksy,wfirma')
  })
})

describe('end-to-end chain (T201)', () => {
  it('parse → shift → serialize', () => {
    const queue = parsePromptQueue('booksy,wfirma,ksef')
    const { head, rest } = shiftPromptQueue(queue)
    expect(head).toBe('booksy')
    expect(serializePromptQueue(rest)).toBe('wfirma,ksef')
  })

  it('exhaust queue', () => {
    let queue = parsePromptQueue('booksy,wfirma')
    let r = shiftPromptQueue(queue)
    queue = r.rest
    expect(r.head).toBe('booksy')
    r = shiftPromptQueue(queue)
    queue = r.rest
    expect(r.head).toBe('wfirma')
    r = shiftPromptQueue(queue)
    expect(r.head).toBeNull()
    expect(serializePromptQueue(r.rest)).toBeNull()
  })
})
