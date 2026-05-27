import { ChevronDown, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { SalonRole } from '@/hooks/useTeam'

export type Permission = 'none' | 'view' | 'edit'
export type PermissionsMap = Record<string, Permission>

/**
 * T26 — блок «Доступы» в модалке приглашения пользователя.
 *
 * Категории = пункты sidebar (Главная / Доходы / Расходы / Отчёты / Финансы /
 * Склад / Маркетинг / Мессенджер / AI / Настройки). Для каждой категории —
 * подкатегории = вкладки соответствующего окна; если вкладок нет — категория
 * дублирует свою иерархию. Напротив каждой строки — 2 чекбокса: «Просмотр»
 * (view) и «Редактирование» (edit; включает view автоматически).
 *
 * Преднастройки по выбранной роли:
 *   - Мастер: Визиты (свои, view) + Настройки → Профиль пользователя (edit)
 *   - Администратор: полные права на доходы/расходы/отчёты/склад/маркетинг/
 *     мессенджер/AI + Настройки → Профиль/Пользователи/График/Помощь (edit)
 *
 * Сейчас компонент — read-only preview: показывает преднастроенные галки
 * по выбранной роли. Реальное сохранение прав в БД будет в следующей
 * миграции (salon_members.permissions jsonb).
 */

type PermissionLeaf = { key: string; label: string }
type PermissionCategory = {
  key: string
  label: string
  /** Если items пуст — категория одна строка с тем же label. */
  items: PermissionLeaf[]
}

const CATEGORIES: PermissionCategory[] = [
  { key: 'dashboard', label: 'Главная', items: [] },
  {
    key: 'income',
    label: 'Доходы',
    items: [
      { key: 'visits', label: 'Визиты' },
      { key: 'sales', label: 'Продажи' },
      { key: 'other', label: 'Прочие доходы' },
      { key: 'banking', label: 'Банкинг' },
    ],
  },
  {
    key: 'expenses',
    label: 'Расходы',
    items: [
      { key: 'paid', label: 'Оплачено' },
      { key: 'pending', label: 'Не оплачено' },
      { key: 'banking', label: 'Банкинг' },
    ],
  },
  {
    key: 'reports',
    label: 'Отчёты',
    items: [
      { key: 'pnl', label: 'Прибыль/убытки' },
      { key: 'staff', label: 'Сотрудники' },
      { key: 'clients', label: 'Клиенты' },
    ],
  },
  {
    key: 'finance',
    label: 'Финансы',
    items: [
      { key: 'pnl', label: 'P&L' },
      { key: 'report', label: 'Отчёт по прибыли' },
      { key: 'payments', label: 'Платежи' },
      { key: 'budgets', label: 'Бюджеты' },
      { key: 'cash', label: 'Касса' },
      { key: 'transfers', label: 'Перестановка средств' },
    ],
  },
  {
    key: 'inventory',
    label: 'Склад',
    items: [
      { key: 'items', label: 'Материалы' },
      { key: 'analytics', label: 'Аналитика' },
    ],
  },
  {
    key: 'marketing',
    label: 'Маркетинг',
    items: [
      { key: 'content', label: 'Контент' },
      { key: 'competitors', label: 'Конкуренты' },
      { key: 'reviews', label: 'Отзывы' },
    ],
  },
  { key: 'messenger', label: 'Мессенджер', items: [] },
  { key: 'ai', label: 'AI-помощник', items: [] },
  {
    key: 'settings',
    label: 'Настройки',
    items: [
      { key: 'profile_user', label: 'Профиль пользователя' },
      { key: 'profile_salon', label: 'Профиль салона' },
      { key: 'users', label: 'Пользователи' },
      { key: 'schedule', label: 'График' },
      { key: 'integrations', label: 'Интеграции' },
      { key: 'help', label: 'Помощь' },
    ],
  },
]

function presetForRole(role: SalonRole): Record<string, Permission> {
  if (role === 'admin') {
    return {
      'dashboard.*': 'edit',
      'income.*': 'edit',
      'expenses.paid': 'edit',
      'expenses.pending': 'edit',
      'reports.*': 'edit',
      'inventory.*': 'edit',
      'marketing.*': 'edit',
      'messenger.*': 'edit',
      'ai.*': 'edit',
      'settings.profile_user': 'edit',
      'settings.users': 'edit',
      'settings.schedule': 'edit',
      'settings.help': 'edit',
    }
  }
  if (role === 'staff') {
    return {
      'income.visits': 'view', // только свои визиты
      'settings.profile_user': 'edit',
    }
  }
  // accountant и др. — дефолт пустой preview
  return {
    'dashboard.*': 'view',
    'income.*': 'view',
    'expenses.*': 'view',
    'reports.*': 'view',
    'finance.*': 'view',
    'settings.profile_user': 'edit',
  }
}

function lookup(preset: Record<string, Permission>, cat: string, sub: string): Permission {
  const exact = preset[`${cat}.${sub}`]
  if (exact) return exact
  const wild = preset[`${cat}.*`]
  if (wild) return wild
  return 'none'
}

export function PermissionsBlock({
  role,
  value,
  onChange,
}: {
  role: SalonRole
  /** Текущая матрица. Если undefined — рендерим preset роли (read-only-like preview). */
  value?: PermissionsMap
  /** Любое изменение чекбокса проксируется в родителя; при role-change — родитель
   *  должен снести state, чтобы PermissionsBlock пересчитал preset. */
  onChange?: (next: PermissionsMap) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [openCats, setOpenCats] = useState<Set<string>>(new Set())
  const preset = useMemo(() => presetForRole(role), [role])

  // При смене роли — если родитель не управляет state'ом, синкаем preset.
  const lastRoleRef = useRef<SalonRole>(role)
  useEffect(() => {
    if (lastRoleRef.current !== role && onChange) {
      onChange({ ...preset })
    }
    lastRoleRef.current = role
  }, [role, preset, onChange])

  const effective: Record<string, Permission> = value ?? preset
  const writable = !!onChange

  function setPerm(key: string, perm: Permission) {
    if (!onChange) return
    const next = { ...effective }
    if (perm === 'none') delete next[key]
    else next[key] = perm
    onChange(next)
  }

  function toggleCat(key: string) {
    setOpenCats((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <section className="border-border overflow-hidden rounded-md border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="bg-muted/30 hover:bg-muted/50 flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
      >
        <span className="inline-flex items-center gap-2">
          {open ? (
            <ChevronDown className="text-muted-foreground size-3.5" strokeWidth={2.2} />
          ) : (
            <ChevronRight className="text-muted-foreground size-3.5" strokeWidth={2.2} />
          )}
          <span className="text-foreground text-sm font-bold">
            {t('team.permissions_title', { defaultValue: 'Доступы' })}
          </span>
        </span>
        <span className="text-muted-foreground text-[11px]">
          {t('team.permissions_subtitle', {
            defaultValue: 'Преднастроено по роли',
          })}
        </span>
      </button>
      <div className={open ? '' : 'hidden'}>
        <div className="border-border bg-muted/10 grid grid-cols-[1fr_80px_80px] gap-2 border-b px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider">
          <span className="text-muted-foreground">
            {t('team.perm_col_section', { defaultValue: 'Раздел' })}
          </span>
          <span className="text-muted-foreground text-center">
            {t('team.perm_col_view', { defaultValue: 'Просмотр' })}
          </span>
          <span className="text-muted-foreground text-center">
            {t('team.perm_col_edit', { defaultValue: 'Редактирование' })}
          </span>
        </div>
        <div className="divide-border/40 divide-y">
          {CATEGORIES.map((cat) => {
            const hasItems = cat.items.length > 0
            const catOpen = openCats.has(cat.key)
            const catKey = hasItems ? `${cat.key}.*` : cat.key
            const catPerm: Permission = hasItems
              ? ((effective[catKey] as Permission | undefined) ?? 'none')
              : lookup(effective, cat.key, cat.key)

            function toggleCatPerm(target: 'view' | 'edit') {
              if (!writable) return
              if (target === 'view') {
                setPerm(catKey, catPerm === 'none' ? 'view' : 'none')
              } else {
                setPerm(catKey, catPerm === 'edit' ? 'view' : 'edit')
              }
            }

            return (
              <div key={cat.key}>
                <div
                  className={`grid grid-cols-[1fr_80px_80px] items-center gap-2 px-3 py-2 ${
                    hasItems ? 'cursor-pointer' : ''
                  }`}
                  onClick={() => {
                    if (hasItems) toggleCat(cat.key)
                  }}
                >
                  <span className="text-foreground inline-flex items-center gap-1.5 text-sm font-semibold">
                    {hasItems ? (
                      catOpen ? (
                        <ChevronDown className="text-muted-foreground size-3" strokeWidth={2.2} />
                      ) : (
                        <ChevronRight className="text-muted-foreground size-3" strokeWidth={2.2} />
                      )
                    ) : (
                      <span className="size-3" />
                    )}
                    {cat.label}
                  </span>
                  <label
                    className="flex cursor-pointer items-center justify-center"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={catPerm === 'view' || catPerm === 'edit'}
                      onChange={() => toggleCatPerm('view')}
                      disabled={!writable}
                      className="accent-brand-navy size-4"
                    />
                  </label>
                  <label
                    className="flex cursor-pointer items-center justify-center"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={catPerm === 'edit'}
                      onChange={() => toggleCatPerm('edit')}
                      disabled={!writable}
                      className="accent-brand-navy size-4"
                    />
                  </label>
                </div>
                {hasItems && catOpen ? (
                  <div className="bg-muted/10 divide-border/30 divide-y">
                    {cat.items.map((it) => {
                      const itKey = `${cat.key}.${it.key}`
                      const perm = lookup(effective, cat.key, it.key)
                      function toggleItem(target: 'view' | 'edit') {
                        if (!writable) return
                        if (target === 'view') {
                          setPerm(itKey, perm === 'none' ? 'view' : 'none')
                        } else {
                          setPerm(itKey, perm === 'edit' ? 'view' : 'edit')
                        }
                      }
                      return (
                        <div
                          key={it.key}
                          className="grid grid-cols-[1fr_80px_80px] items-center gap-2 px-3 py-1.5"
                        >
                          <span className="text-muted-foreground pl-5 text-xs">{it.label}</span>
                          <label className="flex items-center justify-center">
                            <input
                              type="checkbox"
                              checked={perm === 'view' || perm === 'edit'}
                              onChange={() => toggleItem('view')}
                              disabled={!writable}
                              className="accent-brand-navy size-4"
                            />
                          </label>
                          <label className="flex items-center justify-center">
                            <input
                              type="checkbox"
                              checked={perm === 'edit'}
                              onChange={() => toggleItem('edit')}
                              disabled={!writable}
                              className="accent-brand-navy size-4"
                            />
                          </label>
                        </div>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
