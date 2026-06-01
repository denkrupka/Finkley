import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { computeGross, computeNet, computeVatAmount, vatRatesFor } from '@/lib/utils/vat'

type Props = {
  /** Сумма НЕТТО в копейках. */
  netCents: number
  /** Ставка НДС в %. */
  ratePct: number
  /** Сумма БРУТТО в копейках. */
  grossCents: number
  /** Двусторонний onChange — родитель получает все три значения сразу. */
  onChange: (next: { netCents: number; ratePct: number; grossCents: number }) => void
  /** ISO код страны салона — определяет ставки в dropdown. */
  countryCode?: string | null
  currency?: string
  disabled?: boolean
}

/**
 * VAT breakdown input: 3 поля Нетто / Ставка / Брутто с двусторонним
 * пересчётом. Изменение нетто пересчитывает брутто, изменение брутто
 * пересчитывает нетто, смена ставки пересчитывает брутто исходя из нетто.
 *
 * При импорте из KSeF/OCR родитель прокидывает уже посчитанные значения;
 * компонент сам ничего не вычисляет инициально.
 */
export function VatBreakdownInput({
  netCents,
  ratePct,
  grossCents,
  onChange,
  countryCode,
  currency = 'PLN',
  disabled,
}: Props) {
  const { t } = useTranslation()
  const rates = vatRatesFor(countryCode)
  // Локальные текстовые значения для плавного ввода (без re-format при
  // каждом keystroke).
  const [netStr, setNetStr] = useState<string>(() => (netCents / 100).toFixed(2))
  const [grossStr, setGrossStr] = useState<string>(() => (grossCents / 100).toFixed(2))

  const vatCents = computeVatAmount(netCents, grossCents)

  function emitFromNet(rawNet: string) {
    setNetStr(rawNet)
    const cleaned = rawNet.replace(',', '.').trim()
    const num = Number(cleaned)
    if (!isFinite(num)) return
    const nextNet = Math.round(num * 100)
    const nextGross = computeGross(nextNet, ratePct)
    setGrossStr((nextGross / 100).toFixed(2))
    onChange({ netCents: nextNet, ratePct, grossCents: nextGross })
  }
  function emitFromGross(rawGross: string) {
    setGrossStr(rawGross)
    const cleaned = rawGross.replace(',', '.').trim()
    const num = Number(cleaned)
    if (!isFinite(num)) return
    const nextGross = Math.round(num * 100)
    const nextNet = computeNet(nextGross, ratePct)
    setNetStr((nextNet / 100).toFixed(2))
    onChange({ netCents: nextNet, ratePct, grossCents: nextGross })
  }
  function emitFromRate(nextRate: number) {
    const nextGross = computeGross(netCents, nextRate)
    setGrossStr((nextGross / 100).toFixed(2))
    onChange({ netCents, ratePct: nextRate, grossCents: nextGross })
  }

  return (
    <div className="grid grid-cols-12 gap-2">
      <div className="col-span-5">
        <Label htmlFor="vat-net" className="text-[10.5px] uppercase tracking-wider">
          {t('expense.vat.net', { defaultValue: 'Нетто' })}
        </Label>
        <div className="relative mt-1">
          <Input
            id="vat-net"
            inputMode="decimal"
            value={netStr}
            onChange={(e) => emitFromNet(e.target.value)}
            disabled={disabled}
            className="num pr-12 text-right"
          />
          <span className="text-muted-foreground absolute right-3 top-1/2 -translate-y-1/2 text-xs">
            {currency}
          </span>
        </div>
      </div>
      <div className="col-span-2">
        <Label className="text-[10.5px] uppercase tracking-wider">
          {t('expense.vat.rate', { defaultValue: 'НДС' })}
        </Label>
        <select
          value={String(ratePct)}
          onChange={(e) => emitFromRate(Number(e.target.value))}
          disabled={disabled}
          className="border-input bg-background text-foreground focus:border-secondary focus:ring-secondary/20 mt-1 h-9 w-full rounded-md border px-2 text-sm outline-none focus:ring-2"
        >
          {rates.map((r, i) => (
            <option key={`${r.pct}-${i}`} value={r.pct}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <div className="col-span-5">
        <Label htmlFor="vat-gross" className="text-[10.5px] uppercase tracking-wider">
          {t('expense.vat.gross', { defaultValue: 'Брутто' })}
        </Label>
        <div className="relative mt-1">
          <Input
            id="vat-gross"
            inputMode="decimal"
            value={grossStr}
            onChange={(e) => emitFromGross(e.target.value)}
            disabled={disabled}
            className="num pr-12 text-right font-bold"
          />
          <span className="text-muted-foreground absolute right-3 top-1/2 -translate-y-1/2 text-xs">
            {currency}
          </span>
        </div>
      </div>
      {vatCents > 0 ? (
        <p className="text-muted-foreground col-span-12 text-[11px]">
          {t('expense.vat.amount_hint', {
            defaultValue: 'НДС: {{vat}} {{currency}}',
            vat: (vatCents / 100).toFixed(2),
            currency,
          })}
        </p>
      ) : null}
    </div>
  )
}
