import { describe, expect, it } from 'vitest'

import { formatError } from './format-error'

describe('formatError', () => {
  it('returns the string itself when value is a string', () => {
    expect(formatError('boom')).toBe('boom')
  })

  it('returns Error.message when value is an Error instance', () => {
    expect(formatError(new Error('explode'))).toBe('explode')
  })

  it('falls back when Error has empty message', () => {
    expect(formatError(new Error(''), 'fallback')).toBe('fallback')
  })

  it('extracts PostgrestError.message shape', () => {
    const err = {
      message: 'permission denied for table salons',
      details: null,
      hint: null,
      code: '42501',
    }
    expect(formatError(err)).toBe('permission denied for table salons')
  })

  it('extracts AuthApiError.error_description shape', () => {
    const err = { error_description: 'invalid grant', error: 'invalid_grant', status: 400 }
    expect(formatError(err)).toBe('invalid grant')
  })

  it('falls back to details when message is missing', () => {
    expect(formatError({ details: 'no rows updated' })).toBe('no rows updated')
  })

  it('uses statusText for fetch-like errors without messages', () => {
    expect(formatError({ statusText: 'Bad Request' })).toBe('Bad Request')
  })

  it('serializes unknown object as JSON instead of [object Object]', () => {
    expect(formatError({ foo: 1, bar: 'x' })).toBe('{"foo":1,"bar":"x"}')
  })

  it('uses fallback for null / undefined', () => {
    expect(formatError(null, 'default')).toBe('default')
    expect(formatError(undefined, 'default')).toBe('default')
  })

  it('never returns "[object Object]"', () => {
    const tricky = { toString: () => 'this should not be used' }
    const result = formatError(tricky, 'fallback')
    expect(result).not.toBe('[object Object]')
  })
})
