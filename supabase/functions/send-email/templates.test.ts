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

// Извлекает множество плейсхолдеров {{var}} из subject+html шаблона.
function tokenSet(
  alias: Parameters<typeof pickTemplate>[0],
  locale: Parameters<typeof pickTemplate>[1],
): Set<string> {
  const tpl = pickTemplate(alias, locale)
  const tokens = new Set<string>()
  for (const src of [tpl.subject, tpl.html]) {
    for (const m of src.matchAll(/\{\{(\w+)\}\}/g)) tokens.add(m[1])
  }
  return tokens
}

describe('локализация шаблонов (регрессия)', () => {
  // (A) Паритет плейсхолдеров: EN/PL не должны терять {{var}}, который есть в RU —
  // иначе в проде (напр. billing-письмо) переменная отрендерится пустой строкой.
  it('EN и PL имеют тот же набор {{var}}, что и RU, для каждого alias', () => {
    for (const alias of ALLOWED_TEMPLATES) {
      const ru = [...tokenSet(alias, 'ru')].sort()
      const en = [...tokenSet(alias, 'en')].sort()
      const pl = [...tokenSet(alias, 'pl')].sort()
      expect(en, `EN(${alias}) плейсхолдеры расходятся с RU`).toEqual(ru)
      expect(pl, `PL(${alias}) плейсхолдеры расходятся с RU`).toEqual(ru)
    }
  })

  // (B) Нет «тихого» RU-fallback: каждый alias реально переведён на EN и PL.
  // Новый непереведённый alias уронит этот тест, а не утечёт RU польским юзерам.
  it('каждый alias имеет EN и PL subject+html, отличные от RU', () => {
    for (const alias of ALLOWED_TEMPLATES) {
      const ru = pickTemplate(alias, 'ru')
      const en = pickTemplate(alias, 'en')
      const pl = pickTemplate(alias, 'pl')
      expect(en.subject, `EN(${alias}) subject == RU`).not.toBe(ru.subject)
      expect(en.html, `EN(${alias}) html == RU`).not.toBe(ru.html)
      expect(pl.subject, `PL(${alias}) subject == RU`).not.toBe(ru.subject)
      expect(pl.html, `PL(${alias}) html == RU`).not.toBe(ru.html)
    }
  })

  // (C) lang-атрибут: EN/PL версии помечены правильной локалью на <html>.
  it('EN/PL html содержат корректный lang-атрибут', () => {
    for (const alias of ALLOWED_TEMPLATES) {
      expect(pickTemplate(alias, 'en').html, `EN(${alias}) без lang="en"`).toContain('lang="en"')
      expect(pickTemplate(alias, 'pl').html, `PL(${alias}) без lang="pl"`).toContain('lang="pl"')
    }
  })

  // (D) В EN/PL не должно быть кириллицы (правило CLAUDE.md: не класть русский в en/pl).
  it('EN/PL html не содержат кириллицы', () => {
    const cyrillic = /[А-Яа-яЁё]/
    for (const alias of ALLOWED_TEMPLATES) {
      expect(cyrillic.test(pickTemplate(alias, 'en').html), `EN(${alias}) содержит кириллицу`).toBe(
        false,
      )
      expect(cyrillic.test(pickTemplate(alias, 'pl').html), `PL(${alias}) содержит кириллицу`).toBe(
        false,
      )
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
