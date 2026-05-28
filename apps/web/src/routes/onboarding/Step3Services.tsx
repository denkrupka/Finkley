import { Camera, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils/cn'

import { OcrNotebookButton, type ParsedVisit } from './OcrNotebookButton'
import { SEED_SERVICES_BY_TYPE, type SalonTypeId } from './onboarding-defaults'

export type ServiceDraft = {
  id: string
  category_name: string
  name: string
  default_price_cents: number
  /** T100 — длительность услуги в минутах (для capacity-planning и онлайн-
   *  бронирования). Дефолт 60 если не задано. */
  default_duration_min?: number | null
}

function makeNew(category_name = ''): ServiceDraft {
  return {
    id: `srv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    category_name,
    name: '',
    default_price_cents: 0,
    default_duration_min: 60,
  }
}

type Props = {
  value: ServiceDraft[]
  onChange: (v: ServiceDraft[]) => void
  salonType: SalonTypeId
  /** T131 — OCR-блок «Если ведёшь резервации вручную, загрузи фото журнала».
   *  Распознанные визиты добавляются к state.ocr_visits и импортируются
   *  после создания салона. */
  ocrVisits?: ParsedVisit[]
  onOcrVisitsAdded?: (visits: ParsedVisit[]) => void
}

/**
 * T100 — апгрейд Step3Services:
 *   - Группировка по category_name (раскрываемые секции с counter'ом).
 *   - Новое поле default_duration_min (длительность услуги в минутах).
 *   - Drag-to-collapse секции категорий.
 *   - Кнопка «Добавить услугу» прямо в секции категории.
 */
export function Step3Services({
  value,
  onChange,
  salonType,
  ocrVisits = [],
  onOcrVisitsAdded,
}: Props) {
  const { t } = useTranslation()

  // Группировка по category_name. Несуществующая категория группируется
  // как «Без категории».
  const groups = useMemo(() => {
    const map = new Map<string, ServiceDraft[]>()
    for (const s of value) {
      const key = s.category_name.trim() || 'Без категории'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(s)
    }
    return Array.from(map.entries()).map(([name, items]) => ({ name, items }))
  }, [value])

  const [openCats, setOpenCats] = useState<Set<string>>(() => new Set(groups.map((g) => g.name)))
  // T176 — OCR-блок скрыт по умолчанию (юзер с Booksy его не видит), раскрывается
  // ссылкой «Веду резервации вручную / есть фото журнала».
  const [showOcr, setShowOcr] = useState(false)

  function toggleCat(name: string) {
    setOpenCats((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  function update(id: string, patch: Partial<ServiceDraft>) {
    onChange(value.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }

  function remove(id: string) {
    onChange(value.filter((s) => s.id !== id))
  }

  function addInCategory(category: string) {
    onChange([...value, makeNew(category === 'Без категории' ? '' : category)])
    setOpenCats((prev) => new Set([...prev, category]))
  }

  function addNewCategory() {
    onChange([...value, makeNew('Новая категория')])
    setOpenCats((prev) => new Set([...prev, 'Новая категория']))
  }

  function resetSeed() {
    onChange(SEED_SERVICES_BY_TYPE[salonType].map((s, i) => ({ ...s, id: `seed-${i}` })))
  }

  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <h1 className="text-brand-navy text-2xl font-bold tracking-tight">
          {t('onboarding.step3.title')}
        </h1>
        {SEED_SERVICES_BY_TYPE[salonType].length > 0 ? (
          <button
            type="button"
            onClick={resetSeed}
            className="text-secondary text-sm font-semibold hover:underline"
          >
            {t('onboarding.step3.reset_seed')}
          </button>
        ) : null}
      </div>

      {/* T131+T176 — OCR-блок раскрывается явной ссылкой. Не лезет в глаза
          если юзер с Booksy/iCal, но есть для тех кто ведёт резервации
          вручную (Photo journal → AI). */}
      {onOcrVisitsAdded && !showOcr ? (
        <button
          type="button"
          onClick={() => setShowOcr(true)}
          className="text-brand-teal-deep hover:bg-brand-teal-soft/30 mt-3 inline-flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-xs font-bold"
        >
          <Camera className="size-3.5" strokeWidth={2} />
          {t('onboarding.step3.ocr_toggle')}
        </button>
      ) : null}
      {onOcrVisitsAdded && showOcr ? (
        <div className="border-brand-teal-deep/30 bg-brand-teal-soft/10 mt-3 flex flex-col gap-2 rounded-lg border-2 border-dashed p-3">
          <div className="flex items-start gap-2">
            <Camera className="text-brand-teal-deep mt-0.5 size-4 shrink-0" strokeWidth={2} />
            <div className="min-w-0 flex-1">
              <p className="text-foreground text-sm font-bold">{t('onboarding.step3.ocr_title')}</p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {t('onboarding.step3.ocr_body')}
              </p>
            </div>
          </div>
          <OcrNotebookButton
            salonId={null}
            onVisitsParsed={(v) => onOcrVisitsAdded([...ocrVisits, ...v])}
          />
          {ocrVisits.length > 0 ? (
            <p className="text-brand-teal-deep text-xs font-bold">
              {t('onboarding.step3.ocr_collected', { count: ocrVisits.length })}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 flex flex-col gap-2">
        {groups.map((group) => {
          const open = openCats.has(group.name)
          return (
            <section key={group.name} className="border-border overflow-hidden rounded-md border">
              <button
                type="button"
                onClick={() => toggleCat(group.name)}
                className="bg-muted/30 hover:bg-muted/50 flex w-full items-center gap-2 px-3 py-2.5 text-left"
              >
                {open ? (
                  <ChevronDown className="text-muted-foreground size-4 shrink-0" strokeWidth={2} />
                ) : (
                  <ChevronRight className="text-muted-foreground size-4 shrink-0" strokeWidth={2} />
                )}
                <span className="text-foreground text-sm font-bold">{group.name}</span>
                <span className="text-muted-foreground bg-card ml-auto rounded-full px-2 py-0.5 text-xs font-semibold">
                  {group.items.length}
                </span>
              </button>

              <div className={cn(open ? '' : 'hidden', 'px-3 py-3')}>
                <div className="flex flex-col gap-2">
                  {group.items.map((s) => (
                    <div
                      key={s.id}
                      className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_2fr_110px_110px_44px] sm:gap-2.5"
                      data-testid="onb-service-row"
                    >
                      <Input
                        value={s.category_name}
                        onChange={(e) => update(s.id, { category_name: e.target.value })}
                        placeholder={t('onboarding.step3.category_placeholder')}
                        className="h-9 text-sm"
                      />
                      <Input
                        value={s.name}
                        onChange={(e) => update(s.id, { name: e.target.value })}
                        placeholder={t('onboarding.step3.service_placeholder')}
                        className="h-9 text-sm"
                      />
                      {/* Цена */}
                      <div className="border-input bg-card flex h-9 items-center gap-1.5 rounded-md border px-2.5">
                        <input
                          type="number"
                          min="0"
                          value={Math.round(s.default_price_cents / 100)}
                          onChange={(e) =>
                            update(s.id, {
                              default_price_cents: Math.max(0, Number(e.target.value)) * 100,
                            })
                          }
                          className="num text-foreground w-full bg-transparent text-right text-sm font-semibold outline-none"
                        />
                        <span className="text-muted-foreground text-xs">€</span>
                      </div>
                      {/* Длительность */}
                      <div className="border-input bg-card flex h-9 items-center gap-1.5 rounded-md border px-2.5">
                        <input
                          type="number"
                          min="0"
                          step="15"
                          value={s.default_duration_min ?? 60}
                          onChange={(e) =>
                            update(s.id, {
                              default_duration_min: Math.max(0, Number(e.target.value)),
                            })
                          }
                          className="num text-foreground w-full bg-transparent text-right text-sm font-semibold outline-none"
                        />
                        <span className="text-muted-foreground text-xs">мин</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => remove(s.id)}
                        className="border-border text-muted-foreground hover:text-destructive grid size-9 place-items-center rounded-md border"
                        aria-label="remove"
                      >
                        <Trash2 className="size-4" strokeWidth={1.7} />
                      </button>
                    </div>
                  ))}

                  <button
                    type="button"
                    onClick={() => addInCategory(group.name)}
                    className="border-brand-border-strong text-muted-foreground hover:border-secondary hover:text-secondary mt-1 inline-flex items-center gap-1.5 self-start rounded-md border border-dashed px-3 py-1.5 text-xs font-semibold"
                  >
                    <Plus className="size-3" strokeWidth={2.2} />
                    {t('onboarding.step3.add_in_category')}
                  </button>
                </div>
              </div>
            </section>
          )
        })}

        <button
          type="button"
          onClick={addNewCategory}
          className="border-brand-border-strong text-muted-foreground hover:border-secondary hover:text-secondary inline-flex items-center justify-center gap-2 self-start rounded-md border border-dashed px-4 py-2 text-sm font-semibold"
          data-testid="onb-service-add"
        >
          <Plus className="size-4" strokeWidth={1.7} />
          {t('onboarding.step3.add_category')}
        </button>
      </div>
    </div>
  )
}
