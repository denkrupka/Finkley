import { describe, expect, it } from 'vitest'

import { ALLOWED_TEMPLATES, normalizeEmailLocale, pickTemplate, render } from './templates.ts'

describe('normalizeEmailLocale', () => {
  it('ru / en / pl возвращает себя', () => {
    expect(normalizeEmailLocale('ru')).toBe('ru')
    expect(normalizeEmailLocale('en')).toBe('en')
    expect(normalizeEmailLocale('pl')).toBe('pl')
  })

  it('BCP-47 формат (en-US, pl-PL, ru-RU) → берёт первую часть', () => {
    expect(normalizeEmailLocale('en-US')).toBe('en')
    expect(normalizeEmailLocale('pl-PL')).toBe('pl')
    expect(normalizeEmailLocale('ru-RU')).toBe('ru')
  })

  it('case-insensitive', () => {
    expect(normalizeEmailLocale('EN')).toBe('en')
    expect(normalizeEmailLocale('PL-pl')).toBe('pl')
  })

  it('unknown / не строка → fallback ru', () => {
    expect(normalizeEmailLocale('de')).toBe('ru')
    expect(normalizeEmailLocale('fr-FR')).toBe('ru')
    expect(normalizeEmailLocale(undefined)).toBe('ru')
    expect(normalizeEmailLocale(null)).toBe('ru')
    expect(normalizeEmailLocale(123)).toBe('ru')
  })
})

describe('pickTemplate', () => {
  it('welcome RU → русский subject', () => {
    const tpl = pickTemplate('welcome', 'ru')
    expect(tpl.subject).toMatch(/Привет|Finkley/)
  })

  it('welcome EN → английский subject (отличается от RU)', () => {
    const ru = pickTemplate('welcome', 'ru')
    const en = pickTemplate('welcome', 'en')
    expect(en.subject).not.toBe(ru.subject)
  })

  it('welcome PL → польский subject (отличается от RU)', () => {
    const ru = pickTemplate('welcome', 'ru')
    const pl = pickTemplate('welcome', 'pl')
    expect(pl.subject).not.toBe(ru.subject)
  })

  it('trial_ending — EN/PL отличаются от RU', () => {
    expect(pickTemplate('trial_ending', 'en').html).not.toBe(
      pickTemplate('trial_ending', 'ru').html,
    )
    expect(pickTemplate('trial_ending', 'pl').html).not.toBe(
      pickTemplate('trial_ending', 'ru').html,
    )
  })

  it('все TemplateAlias имеют не-пустые subject и html в RU', () => {
    for (const alias of ALLOWED_TEMPLATES) {
      const tpl = pickTemplate(alias, 'ru')
      expect(tpl.subject.length).toBeGreaterThan(0)
      expect(tpl.html.length).toBeGreaterThan(0)
    }
  })
})

describe('render', () => {
  it('подставляет {{var}}', () => {
    expect(render('Hello {{name}}', { name: 'Anna' })).toBe('Hello Anna')
  })

  it('несколько переменных + повтор', () => {
    expect(render('{{name}}, {{name}}! Salon: {{salon}}', { name: 'Anna', salon: 'Studio' })).toBe(
      'Anna, Anna! Salon: Studio',
    )
  })

  it('null/undefined → пустая строка', () => {
    expect(render('start{{x}}end', { x: null })).toBe('startend')
    expect(render('start{{x}}end', {})).toBe('startend')
  })

  it('числа конвертируются в строку', () => {
    expect(render('left: {{days}}', { days: 7 })).toBe('left: 7')
  })

  it('не трогает текст без {{...}}', () => {
    expect(render('plain text without placeholders', {})).toBe('plain text without placeholders')
  })

  it('HTML-payload — не интерполирует вложенные {{ через render', () => {
    // {{ внутри XSS-payload не выполняется при подстановке имени
    const out = render('Hello {{name}}', { name: '<script>alert(1)</script>' })
    // render не делает HTML escape — это ответственность шаблона.
    expect(out).toBe('Hello <script>alert(1)</script>')
  })
})
