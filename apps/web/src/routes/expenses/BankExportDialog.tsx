import { Download, FileText, Landmark, Loader2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useBankAccountsForConnections, useBankConnections } from '@/hooks/useBanking'
import { useCounterparties } from '@/hooks/useCounterparties'
import { useSalon } from '@/hooks/useSalons'
import { type ScheduledPaymentRow } from '@/hooks/useScheduledPayments'
import { formatIbanForDisplay, isIbanValid, normalizeIban } from '@/lib/banking/iban'
import { buildElixirO } from '@/lib/banking/elixir-o'
import {
  buildSepaXml,
  downloadFile,
  EXPORT_FORMATS,
  type ExportFormat,
  type SepaPayment,
} from '@/lib/banking/sepa-xml'
import { formatCurrency } from '@/lib/utils/format-currency'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  salonId: string
  payments: ScheduledPaymentRow[]
}

/**
 * Модалка экспорта запланированных платежей в банк. Юзер выбирает:
 *  1) Счёт-источник (из подключённых через Enable Banking, или вводит вручную)
 *  2) Дата исполнения (default — завтра, ближайший банк-день)
 *  3) Формат — пока только SEPA XML (pain.001.001.03), принимается всеми EU банками
 *
 * При сабмите генерируется файл и триггерится download. Юзер потом
 * загружает файл в свой банковский интерфейс (PKO/Santander/mBank/etc).
 *
 * Платежи без IBAN получателя — флагаются как ошибочные, экспорт блокируется.
 */
export function BankExportDialog({ open, onOpenChange, salonId, payments }: Props) {
  const { t } = useTranslation()
  const { data: salon } = useSalon(salonId)
  const { data: connections = [] } = useBankConnections(salonId)
  const connectionIds = useMemo(() => connections.map((c) => c.id), [connections])
  const { data: bankAccounts = [] } = useBankAccountsForConnections(connectionIds)
  const { data: counterparties = [] } = useCounterparties(salonId)

  // Подключённые счета — IBAN-источник. Если есть — preselect первый.
  // Если нет интеграции — юзер вписывает IBAN вручную.
  const connectedAccounts = useMemo(
    () => bankAccounts.filter((a) => a.iban && a.is_active),
    [bankAccounts],
  )
  const [sourceMode, setSourceMode] = useState<'connected' | 'manual'>(
    connectedAccounts.length > 0 ? 'connected' : 'manual',
  )
  const [selectedAccountId, setSelectedAccountId] = useState<string>(connectedAccounts[0]?.id ?? '')
  const [manualIban, setManualIban] = useState<string>('')
  const [format, setFormat] = useState<ExportFormat>('sepa-xml')
  // Default — завтра (next business day аппроксимация: пятница → понедельник).
  const tomorrow = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    // Если суббота (6) → +2, воскресенье (0) → +1
    const dow = d.getDay()
    if (dow === 6) d.setDate(d.getDate() + 2)
    else if (dow === 0) d.setDate(d.getDate() + 1)
    return d.toISOString().slice(0, 10)
  }, [])
  const [executionDate, setExecutionDate] = useState<string>(tomorrow)
  const [busy, setBusy] = useState(false)

  // Разбор валидности платежей: для экспорта нужен IBAN получателя.
  const cpById = useMemo(() => new Map(counterparties.map((c) => [c.id, c])), [counterparties])
  const enrichedPayments = useMemo(() => {
    return payments.map((p) => {
      const cp = p.counterparty_id ? cpById.get(p.counterparty_id) : null
      const creditorIban = normalizeIban(p.bank_account_iban ?? cp?.bank_account_iban ?? '')
      const creditorName = cp?.name ?? p.vendor_name ?? '—'
      return {
        row: p,
        creditorIban,
        creditorName,
        valid: !!creditorIban && isIbanValid(creditorIban),
      }
    })
  }, [payments, cpById])
  const validCount = enrichedPayments.filter((p) => p.valid).length
  const invalidCount = enrichedPayments.length - validCount

  const sourceIban =
    sourceMode === 'connected'
      ? normalizeIban(connectedAccounts.find((a) => a.id === selectedAccountId)?.iban ?? '')
      : normalizeIban(manualIban)
  const sourceIbanValid = sourceIban ? isIbanValid(sourceIban) : false
  const canExport = sourceIbanValid && validCount > 0 && !busy

  function handleExport() {
    if (!canExport) return
    setBusy(true)
    try {
      const sepaPayments: SepaPayment[] = enrichedPayments
        .filter((p) => p.valid)
        .map((p, idx) => ({
          endToEndId: `FK-${p.row.id.slice(0, 8)}-${idx + 1}`,
          amountCents: p.row.amount_cents,
          currency: salon?.currency ?? 'PLN',
          creditorName: p.creditorName,
          creditorIban: p.creditorIban,
          remittance:
            p.row.invoice_number ??
            p.row.vendor_name ??
            p.row.comment ??
            `Payment ${p.row.id.slice(0, 8)}`,
        }))

      const fmt = EXPORT_FORMATS.find((f) => f.id === format)!
      const fileContent =
        format === 'elixir-o'
          ? buildElixirO({
              debtorName: salon?.name ?? 'Finkley Salon',
              debtorIban: sourceIban,
              executionDate,
              payments: sepaPayments,
            })
          : buildSepaXml({
              debtorName: salon?.name ?? 'Finkley Salon',
              debtorIban: sourceIban,
              executionDate,
              payments: sepaPayments,
            })

      const filename = `finkley-transfers-${new Date().toISOString().slice(0, 10)}.${fmt.extension}`
      downloadFile(filename, fileContent, fmt.mime)
      toast.success(t('banking.export.toast_downloaded', { count: sepaPayments.length }))
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:!w-[680px] sm:!max-w-[680px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Landmark className="text-brand-teal-deep size-4" strokeWidth={2} />
            {t('banking.export.title')}
          </DialogTitle>
          <DialogDescription>{t('banking.export.subtitle')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 px-5 pb-2">
          {/* Источник перевода — connected bank account или manual IBAN */}
          <div className="flex flex-col gap-1.5">
            <Label>{t('banking.export.source_label')}</Label>
            {connectedAccounts.length > 0 ? (
              <div className="flex flex-col gap-2">
                <div className="border-input flex gap-1.5 rounded-md border p-0.5">
                  <button
                    type="button"
                    onClick={() => setSourceMode('connected')}
                    className={`flex-1 rounded px-3 py-1.5 text-xs font-semibold transition-colors ${
                      sourceMode === 'connected'
                        ? 'bg-brand-teal-soft text-brand-teal-deep'
                        : 'text-muted-foreground hover:bg-muted/40'
                    }`}
                  >
                    {t('banking.export.source_connected')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSourceMode('manual')}
                    className={`flex-1 rounded px-3 py-1.5 text-xs font-semibold transition-colors ${
                      sourceMode === 'manual'
                        ? 'bg-brand-teal-soft text-brand-teal-deep'
                        : 'text-muted-foreground hover:bg-muted/40'
                    }`}
                  >
                    {t('banking.export.source_manual')}
                  </button>
                </div>
                {sourceMode === 'connected' ? (
                  <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {connectedAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name ?? '—'} · {formatIbanForDisplay(a.iban)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={manualIban}
                    onChange={(e) => setManualIban(e.target.value)}
                    onBlur={(e) => setManualIban(formatIbanForDisplay(e.target.value))}
                    placeholder="PL61 1090 1014 0000 0712 1981 2874"
                    className="num"
                  />
                )}
              </div>
            ) : (
              <>
                <Input
                  value={manualIban}
                  onChange={(e) => setManualIban(e.target.value)}
                  onBlur={(e) => setManualIban(formatIbanForDisplay(e.target.value))}
                  placeholder="PL61 1090 1014 0000 0712 1981 2874"
                  className="num"
                />
                <p className="text-muted-foreground text-[10.5px]">
                  {t('banking.export.no_integration_hint')}
                </p>
              </>
            )}
            {sourceIban && !sourceIbanValid ? (
              <p className="text-destructive text-[11px]">{t('banking.export.iban_invalid')}</p>
            ) : null}
          </div>

          {/* Дата исполнения */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="exp-date">{t('banking.export.execution_date')}</Label>
              <Input
                id="exp-date"
                type="date"
                value={executionDate}
                onChange={(e) => setExecutionDate(e.target.value)}
                min={new Date().toISOString().slice(0, 10)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="exp-format">{t('banking.export.format_label')}</Label>
              <Select value={format} onValueChange={(v) => setFormat(v as ExportFormat)}>
                <SelectTrigger id="exp-format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPORT_FORMATS.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {t(f.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Summary платежей */}
          <div className="border-border bg-muted/30 rounded-md border p-3">
            <p className="text-foreground mb-2 text-sm font-semibold">
              {t('banking.export.summary_title', {
                valid: validCount,
                total: payments.length,
              })}
            </p>
            <ul className="text-foreground/80 max-h-[200px] overflow-y-auto text-xs">
              {enrichedPayments.map((p) => (
                <li
                  key={p.row.id}
                  className={`border-border/50 flex items-center justify-between gap-2 border-b py-1.5 last:border-b-0 ${
                    p.valid ? '' : 'text-destructive opacity-70'
                  }`}
                >
                  <span className="flex-1 truncate">
                    <strong>{p.creditorName}</strong>
                    {p.row.invoice_number ? ` · ${p.row.invoice_number}` : ''}
                    {!p.valid ? (
                      <span className="text-destructive ml-1.5 text-[10px] font-bold uppercase">
                        ({t('banking.export.missing_iban')})
                      </span>
                    ) : null}
                  </span>
                  <span className="num shrink-0 font-bold">
                    {formatCurrency(p.row.amount_cents, salon?.currency ?? 'PLN')}
                  </span>
                </li>
              ))}
            </ul>
            {invalidCount > 0 ? (
              <p className="text-destructive mt-2 text-[10.5px]">
                {t('banking.export.invalid_skipped', { count: invalidCount })}
              </p>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleExport} disabled={!canExport}>
            {busy ? (
              <Loader2 className="size-4 animate-spin" strokeWidth={2} />
            ) : (
              <Download className="size-4" strokeWidth={2} />
            )}
            {t('banking.export.download_button')}
          </Button>
        </DialogFooter>
        {validCount === 0 && payments.length > 0 ? (
          <div className="text-destructive flex items-center gap-1.5 px-5 pb-3 text-xs">
            <FileText className="size-3.5" strokeWidth={2} />
            {t('banking.export.no_valid_payments')}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
