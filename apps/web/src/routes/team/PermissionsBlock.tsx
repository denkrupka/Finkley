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
  { key: 'dashboard', label: 'team.perm_cat_dashboard', items: [] },
  {
    key: 'income',
    label: 'team.perm_cat_income',
    items: [
      { key: 'visits', label: 'team.perm_item_income_visits' },
      { key: 'sales', label: 'team.perm_item_income_sales' },
      { key: 'other', label: 'team.perm_item_income_other' },
      { key: 'banking', label: 'team.perm_item_income_banking' },
    ],
  },
  {
    key: 'expenses',
    label: 'team.perm_cat_expenses',
    items: [
      { key: 'paid', label: 'team.perm_item_expenses_paid' },
      { key: 'pending', label: 'team.perm_item_expenses_pending' },
      { key: 'banking', label: 'team.perm_item_expenses_banking' },
    ],
  },
  {
    key: 'reports',
    label: 'team.perm_cat_reports',
    items: [
      { key: 'pnl', label: 'team.perm_item_reports_pnl' },
      { key: 'staff', label: 'team.perm_item_reports_staff' },
      { key: 'clients', label: 'team.perm_item_reports_clients' },
    ],
  },
  {
    key: 'finance',
    label: 'team.perm_cat_finance',
    items: [
      { key: 'pnl', label: 'team.perm_item_finance_pnl' },
      { key: 'report', label: 'team.perm_item_finance_report' },
      { key: 'payments', label: 'team.perm_item_finance_payments' },
      { key: 'budgets', label: 'team.perm_item_finance_budgets' },
      { key: 'cash', label: 'team.perm_item_finance_cash' },
      { key: 'transfers', label: 'team.perm_item_finance_transfers' },
    ],
  },
  {
    key: 'inventory',
    label: 'team.perm_cat_inventory',
    items: [
      { key: 'items', label: 'team.perm_item_inventory_items' },
      { key: 'analytics', label: 'team.perm_item_inventory_analytics' },
    ],
  },
  {
    key: 'marketing',
    label: 'team.perm_cat_marketing',
    items: [
      { key: 'content', label: 'team.perm_item_marketing_content' },
      { key: 'competitors', label: 'team.perm_item_marketing_competitors' },
      { key: 'reviews', label: 'team.perm_item_marketing_reviews' },
    ],
  },
  { key: 'messenger', label: 'team.perm_cat_messenger', items: [] },
  { key: 'ai', label: 'team.perm_cat_ai', items: [] },
  {
    key: 'settings',
    label: 'team.perm_cat_settings',
    items: [
      { key: 'profile_user', label: 'team.perm_item_settings_profile_user' },
      { key: 'profile_salon', label: 'team.perm_item_settings_profile_salon' },
      { key: 'users', label: 'team.perm_item_settings_users' },
      { key: 'schedule', label: 'team.perm_item_settings_schedule' },
      { key: 'integrations', label: 'team.perm_item_settings_integrations' },
      { key: 'help', label: 'team.perm_item_settings_help' },
    ],
  },
]

const CATEGORY_DEFAULTS: Record<string, string> = {
  'team.perm_cat_dashboard': 'Главная',
  'team.perm_cat_income': 'Доходы',
  'team.perm_item_income_visits': 'Визиты',
  'team.perm_item_income_sales': 'Продажи',
  'team.perm_item_income_other': 'Прочие доходы',
  'team.perm_item_income_banking': 'Банкинг',
  'team.perm_cat_expenses': 'Расходы',
  'team.perm_item_expenses_paid': 'Оплачено',
  'team.perm_item_expenses_pending': 'Не оплачено',
  'team.perm_item_expenses_banking': 'Банкинг',
  'team.perm_cat_reports': 'Отчёты',
  'team.perm_item_reports_pnl': 'Прибыль/убытки',
  'team.perm_item_reports_staff': 'Сотрудники',
  'team.perm_item_reports_clients': 'Клиенты',
  'team.perm_cat_finance': 'Финансы',
  'team.perm_item_finance_pnl': 'P&L',
  'team.perm_item_finance_report': 'Отчёт по прибыли',
  'team.perm_item_finance_payments': 'Платежи',
  'team.perm_item_finance_budgets': 'Бюджеты',
  'team.perm_item_finance_cash': 'Касса',
  'team.perm_item_finance_transfers': 'Перестановка средств',
  'team.perm_cat_inventory': 'Склад',
  'team.perm_item_inventory_items': 'Материалы',
  'team.perm_item_inventory_analytics': 'Аналитика',
  'team.perm_cat_marketing': 'Маркетинг',
  'team.perm_item_marketing_content': 'Контент',
  'team.perm_item_marketing_competitors': 'Конкуренты',
  'team.perm_item_marketing_reviews': 'Отзывы',
  'team.perm_cat_messenger': 'Мессенджер',
  'team.perm_cat_ai': 'AI-помощник',
  'team.perm_cat_settings': 'Настройки',
  'team.perm_item_settings_profile_user': 'Профиль пользователя',
  'team.perm_item_settings_profile_salon': 'Профиль салона',
  'team.perm_item_settings_users': 'Пользователи',
  'team.perm_item_settings_schedule': 'График',
  'team.perm_item_settings_integrations': 'Интеграции',
  'team.perm_item_settings_help': 'Помощь',
}

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
  if (role === 'external') {
    // Внешний пользователь — по умолчанию ничего, кроме своего профиля.
    // Владелец явно отметит галочки на тех разделах которые нужны.
    return {
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
  // Owner-feedback 04.06: блок «Доступы» был accordion-collapse, юзер думал
  // что его нет вообще. Убираю accordion — секция всегда видна.
  const [openCats, setOpenCats] = useState<Set<string>>(
    () => new Set(CATEGORIES.filter((c) => c.items.length > 0).map((c) => c.key)),
  )
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
      <div className="bg-muted/30 flex w-full items-center justify-between gap-2 px-3 py-2.5">
        <span className="text-foreground text-sm font-bold">
          {t('team.permissions_title', { defaultValue: 'Доступы' })}
        </span>
        <span className="text-muted-foreground text-[11px]">
          {t('team.permissions_subtitle', {
            defaultValue: 'Преднастроено по роли — можешь скорректировать чекбоксами',
          })}
        </span>
      </div>
      <div>
        <div className="border-border bg-muted/10 grid grid-cols-[minmax(0,1fr)_72px_72px] gap-2 border-b px-3 py-1.5 text-[10px] font-bold uppercase leading-tight">
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
                  className={`grid grid-cols-[minmax(0,1fr)_72px_72px] items-center gap-2 px-3 py-2 ${
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
                    {t(cat.label, { defaultValue: CATEGORY_DEFAULTS[cat.label] ?? cat.label })}
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
                          className="grid grid-cols-[minmax(0,1fr)_72px_72px] items-center gap-2 px-3 py-1.5"
                        >
                          <span className="text-muted-foreground pl-5 text-xs">
                            {t(it.label, { defaultValue: CATEGORY_DEFAULTS[it.label] ?? it.label })}
                          </span>
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
