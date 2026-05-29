#!/usr/bin/env node
/**
 * T200+T216+T222 — синхронизация t() defaultValue с JSON локалями.
 *
 * Для каждого t('key', { defaultValue: 'text' }):
 *   1. Если key есть в ru.json — удаляет defaultValue из кода
 *   2. Если нет — добавляет в ru.json + EN/PL копию ТОЛЬКО в ru
 *      (EN/PL остаются undefined и i18next fallback'ит на ru — это
 *      честнее чем класть русский текст под видом английского, см.
 *      T214 и docs/i18n-todo.md).
 *
 * Пропускает:
 *   - defaultValue: '' (намеренный пустой fallback для filter(Boolean))
 *   - defaultValue: variable (динамические значения, не строковые литералы)
 *   - defaultValue: t(...) (composition — оставляем как есть)
 *
 * Запуск: pnpm i18n:sync (см. package.json scripts)
 */

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const PATHS = [
  'apps/web/src/routes/onboarding',
  'apps/web/src/routes/dashboard',
  'apps/web/src/routes/integrations',
  'apps/web/src/routes/knowledge',
  'apps/web/src/routes/media',
  'apps/web/src/routes/reports-hub',
  'apps/web/src/components/onboarding-tour',
]

const RU = `${REPO_ROOT}/apps/web/src/i18n/locales/ru.json`
const ruJson = JSON.parse(readFileSync(RU, 'utf8'))

function getDeep(obj, path) {
  const parts = path.split('.')
  let cur = obj
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = cur[p]
  }
  return cur
}

function setDeep(obj, path, value) {
  const parts = path.split('.')
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {}
    cur = cur[parts[i]]
  }
  cur[parts[parts.length - 1]] = value
}

const grepOut = execSync(`grep -rEn "defaultValue:" ${PATHS.join(' ')} 2>&1 || true`, {
  cwd: REPO_ROOT,
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024,
})

const filesToTouch = new Set()
for (const line of grepOut.split('\n')) {
  const m = /^(.+?):(\d+):/.exec(line)
  if (m) filesToTouch.add(m[1])
}

let keysAdded = 0
let keysExisted = 0
let occurrencesStripped = 0

for (const filePath of filesToTouch) {
  const absPath = `${REPO_ROOT}/${filePath}`
  let content = readFileSync(absPath, 'utf8')
  const before = content

  const re =
    /t\(\s*(['"`])([\w.]+)\1\s*,\s*\{\s*defaultValue:\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)([^}]*)\}\s*\)/g
  content = content.replace(re, (full, _q, key, sQuote, dQuote, bTick, rest) => {
    const value = sQuote ?? dQuote ?? bTick
    // Пропускаем пустые defaultValue (намеренный fallback для filter(Boolean)).
    if (value === '') return full
    // Пропускаем если rest содержит другие interpolations (count, ...) —
    // это безопасно, если ключ есть в JSON, но иногда там бывает
    // вычисляемая `defaultValue: t(...)`.
    const existing = getDeep(ruJson, key)
    if (typeof existing === 'string' && existing.length > 0) {
      keysExisted++
    } else {
      setDeep(ruJson, key, value)
      keysAdded++
    }
    occurrencesStripped++
    const cleanRest = rest.replace(/^\s*,?\s*/, '').replace(/\s+$/, '')
    if (cleanRest.length === 0) {
      return `t('${key}')`
    }
    return `t('${key}', { ${cleanRest} })`
  })

  if (content !== before) {
    writeFileSync(absPath, content)
    console.log(`  rewrote: ${filePath}`)
  }
}

writeFileSync(RU, JSON.stringify(ruJson, null, 2) + '\n')

console.log(
  `\nDone. Stripped ${occurrencesStripped} defaultValue occurrences. ` +
    `Added ${keysAdded} new RU keys. ${keysExisted} keys already existed.`,
)
console.log(
  'EN/PL не обновляем — i18next делает fallback на ru через fallbackLng. ' +
    'Profession-grade переводы — отдельный спринт (см. docs/i18n-todo.md).',
)
process.exit(0)
