import { Calendar, Loader2, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  useAddHolidays,
  useDeleteHoliday,
  useDeleteHolidaysByCountry,
  useSalonHolidays,
} from '@/hooks/useSalonHours'
import { getHolidays, HOLIDAY_COUNTRIES } from '@/lib/holidays'

/**
 * Праздничные/нерабочие даты салона. Хранится в salon_holidays — отдельная
 * таблица; можно добавить одиночную дату руками или одной кнопкой загрузить
 * госпраздники страны (см. lib/holidays.ts).
 *
 * Используется календарём резерваций для штриховки нерабочих дней.
 * Разнесён с графиком работы (SalonHoursCard) на отдельную подвкладку
 * в Settings → «График работы».
 */
export function SalonHolidaysCard() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const { data: holidays = [] } = useSalonHolidays(salonId)
  const addHolidays = useAddHolidays(salonId)
  const deleteHoliday = useDeleteHoliday(salonId)
  const deleteByCountry = useDeleteHolidaysByCountry(salonId)

  const [holidayDate, setHolidayDate] = useState('')
  const [holidayLabel, setHolidayLabel] = useState('')
  const [selectedCountry, setSelectedCountry] = useState<string>('PL')
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear())

  const installedCountries = useMemo(() => {
    const set = new Set<string>()
    for (const h of holidays) if (h.country_code) set.add(h.country_code)
    return set
  }, [holidays])

  function addOneHoliday() {
    const date = holidayDate.trim()
    const label = holidayLabel.trim() || t('settings.opening_hours.holiday_default')
    if (!date) return
    addHolidays.mutate([{ date, label }], {
      onSuccess: () => {
        toast.success(t('settings.opening_hours.toast_holiday_added'))
        setHolidayDate('')
        setHolidayLabel('')
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
    })
  }

  function loadCountryHolidays() {
    const list = getHolidays(selectedCountry, selectedYear)
    if (list.length === 0) {
      toast.error(t('settings.opening_hours.no_holidays_for_country'))
      return
    }
    addHolidays.mutate(
      list.map((h) => ({ date: h.date, label: h.label, country_code: selectedCountry })),
      {
        onSuccess: () =>
          toast.success(
            t('settings.opening_hours.toast_country_loaded', {
              count: list.length,
              year: selectedYear,
            }),
          ),
        onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
      },
    )
  }

  function removeCountryHolidays(code: string) {
    if (!confirm(t('settings.opening_hours.confirm_remove_country'))) return
    deleteByCountry.mutate(code, {
      onSuccess: () => toast.success(t('settings.opening_hours.toast_country_removed')),
      onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
    })
  }

  return (
    <section className="border-border bg-card shadow-finsm rounded-lg border p-5 sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <Calendar className="text-brand-teal size-5" strokeWidth={1.8} />
        <h2 className="text-brand-navy text-base font-bold tracking-tight">
          {t('settings.opening_hours.holidays_title')}
        </h2>
      </div>
      <p className="text-muted-foreground mb-4 text-sm">
        {t('settings.opening_hours.holidays_hint')}
      </p>

      {/* Шаблоны: госпраздники */}
      <div className="bg-muted/20 border-border mb-4 rounded-md border p-3">
        <Label className="text-muted-foreground text-[11px] font-semibold uppercase">
          {t('settings.opening_hours.templates')}
        </Label>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_120px_auto]">
          <Select value={selectedCountry} onValueChange={setSelectedCountry}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HOLIDAY_COUNTRIES.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.flag} {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="number"
            min="2024"
            max="2030"
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value) || selectedYear)}
            className="num h-9"
          />
          <Button onClick={loadCountryHolidays} disabled={addHolidays.isPending} size="md">
            {addHolidays.isPending ? (
              <Loader2 className="size-4 animate-spin" strokeWidth={2} />
            ) : (
              <Plus className="size-4" strokeWidth={2} />
            )}
            {t('settings.opening_hours.load_country')}
          </Button>
        </div>
        {installedCountries.size > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {Array.from(installedCountries).map((code) => {
              const c = HOLIDAY_COUNTRIES.find((x) => x.code === code)
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => removeCountryHolidays(code)}
                  title={t('settings.opening_hours.remove_country_tooltip')}
                  className="bg-card border-border hover:border-destructive/40 hover:text-destructive inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors"
                >
                  <span>{c?.flag ?? code}</span>
                  <span>{c?.label ?? code}</span>
                  <Trash2 className="size-3" strokeWidth={1.8} />
                </button>
              )
            })}
          </div>
        ) : null}
      </div>

      {/* Ручное добавление одной даты */}
      <div className="bg-muted/20 border-border mb-4 rounded-md border p-3">
        <Label className="text-muted-foreground text-[11px] font-semibold uppercase">
          {t('settings.opening_hours.add_one')}
        </Label>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[140px_1fr_auto]">
          <Input
            type="date"
            value={holidayDate}
            onChange={(e) => setHolidayDate(e.target.value)}
            className="h-9"
          />
          <Input
            value={holidayLabel}
            onChange={(e) => setHolidayLabel(e.target.value)}
            placeholder={t('settings.opening_hours.holiday_label_placeholder')}
            className="h-9"
          />
          <Button
            onClick={addOneHoliday}
            disabled={addHolidays.isPending || !holidayDate}
            size="md"
          >
            <Plus className="size-4" strokeWidth={2} />
            {t('settings.opening_hours.add')}
          </Button>
        </div>
      </div>

      {/* Список текущих выходных */}
      {holidays.length === 0 ? (
        <p className="text-muted-foreground text-center text-xs">
          {t('settings.opening_hours.no_holidays')}
        </p>
      ) : (
        <div className="border-border bg-card overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-border bg-muted/10 border-b">
              <tr className="text-muted-foreground text-left text-[11px] font-semibold uppercase tracking-wider">
                <th className="w-32 px-3 py-2">{t('settings.opening_hours.col_date')}</th>
                <th className="px-3 py-2">{t('settings.opening_hours.col_label')}</th>
                <th className="w-24 px-3 py-2">{t('settings.opening_hours.col_country')}</th>
                <th className="w-12 px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {holidays.map((h) => {
                const c = h.country_code
                  ? HOLIDAY_COUNTRIES.find((x) => x.code === h.country_code)
                  : null
                return (
                  <tr key={h.id} className="hover:bg-muted/30">
                    <td className="num text-foreground px-3 py-2 text-xs">{h.date}</td>
                    <td className="text-foreground px-3 py-2 text-sm">{h.label}</td>
                    <td className="text-muted-foreground px-3 py-2 text-xs">
                      {c ? `${c.flag} ${c.code}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => deleteHoliday.mutate(h.id)}
                        className="text-muted-foreground hover:text-destructive grid size-7 place-items-center rounded-md"
                      >
                        <Trash2 className="size-3.5" strokeWidth={1.8} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
