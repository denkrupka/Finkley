import { describe, expect, it } from 'vitest'

import { shouldOverwrite } from './booksy-overwrite'

describe('shouldOverwrite — anti-overwrite policy ядро Booksy sync', () => {
  describe('первый sync (booksyPrev отсутствует)', () => {
    it('booksyPrev=undefined → возвращаем booksyNow', () => {
      expect(shouldOverwrite('local', undefined, 'booksy_new')).toBe('booksy_new')
    })

    it('booksyPrev=null → возвращаем booksyNow', () => {
      expect(shouldOverwrite('local', null, 'booksy_new')).toBe('booksy_new')
    })

    it('первый sync с number=0 (legit value) — тоже возвращаем', () => {
      // Critical: booksyPrev=null branch must trigger BEFORE eq() check
      expect(shouldOverwrite(0, undefined, 60)).toBe(60)
    })
  })

  describe('Booksy не менял (booksyNow === booksyPrev)', () => {
    it('одинаковые строки → undefined', () => {
      expect(shouldOverwrite('local', 'booksy_same', 'booksy_same')).toBeUndefined()
    })

    it('одинаковые числа → undefined', () => {
      expect(shouldOverwrite(99, 60, 60)).toBeUndefined()
    })

    it('одинаковые объекты (JSON deep eq) → undefined', () => {
      expect(shouldOverwrite({ x: 1 }, { x: 1, name: 'a' }, { x: 1, name: 'a' })).toBeUndefined()
    })
  })

  describe('юзер не трогал (localValue === booksyPrev) → перезаписываем', () => {
    it('local совпадает с booksyPrev → возвращаем booksyNow', () => {
      expect(shouldOverwrite('booksy_old', 'booksy_old', 'booksy_new')).toBe('booksy_new')
    })

    it('local=0, booksyPrev=0, booksyNow=60 → 60 (главный кейс bug-fix variants)', () => {
      expect(shouldOverwrite(0, 0, 60)).toBe(60)
    })

    it('объекты совпадают по содержимому → перезаписываем', () => {
      expect(shouldOverwrite({ a: 1 }, { a: 1 }, { a: 2 })).toEqual({ a: 2 })
    })
  })

  describe('юзер переопределил (localValue !== booksyPrev) → НЕ трогаем', () => {
    it('local изменён юзером → undefined даже если booksy предлагает новое', () => {
      expect(shouldOverwrite('my-name', 'old-booksy', 'new-booksy')).toBeUndefined()
    })

    it('local=30 (юзер задал), booksyPrev=60, booksyNow=90 → undefined', () => {
      expect(shouldOverwrite(30, 60, 90)).toBeUndefined()
    })

    it('local=null vs booksyPrev=60, booksyNow=90 — local сбросил → undefined', () => {
      expect(shouldOverwrite(null, 60, 90)).toBeUndefined()
    })
  })

  describe('edge cases', () => {
    it('booksyPrev=0 (не null!) и local=0, booksyNow=null → null', () => {
      // 0 не считается "первым sync" — booksyPrev=0 это legit value
      expect(shouldOverwrite(0, 0, null)).toBeNull()
    })

    it('booksyPrev=false (boolean) — НЕ срабатывает first-sync branch', () => {
      // false != null/undefined, так что first-sync branch не сработает.
      // Проверяем eq(booksyNow, booksyPrev) → false === true → no.
      // eq(local, booksyPrev) → true === false → no. Возвращаем undefined.
      expect(shouldOverwrite(true, false, true)).toBeUndefined()
    })

    it('booksyPrev=false, local=false, booksyNow=true — юзер не трогал → true', () => {
      expect(shouldOverwrite(false, false, true)).toBe(true)
    })

    it('пустая строка booksyPrev="" — не falsy-special, нормальное значение', () => {
      // "" != null/undefined, так что не first-sync
      expect(shouldOverwrite('', '', 'new')).toBe('new')
      expect(shouldOverwrite('custom', '', 'new')).toBeUndefined()
    })
  })

  describe('null vs undefined precedence', () => {
    it('booksyNow=null (Booksy убрал значение) — first-sync если prev=null', () => {
      expect(shouldOverwrite('local', null, null)).toBe(null)
    })

    it('booksyNow=null, prev=oldValue, local=oldValue — юзер не трогал, сбрасываем', () => {
      expect(shouldOverwrite('shared', 'shared', null)).toBeNull()
    })
  })
})
