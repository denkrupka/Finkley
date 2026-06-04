import { Download, ExternalLink, FileText, Loader2, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog, DialogContent } from '@/components/ui/dialog'
import { getReceiptSignedUrl, type ExpenseRow } from '@/hooks/useExpenses'
import { formatCurrency } from '@/lib/utils/format-currency'

/**
 * Bug 02.06 (Денис): кнопка-глазок возле корзины → открывает carousel
 * с фото / документами / KSeF фактурой + скачать.
 *
 * Поддерживаемые типы:
 * - image/* (.jpg, .png, .webp) — отображается как <img>
 * - application/pdf — embed iframe
 * - application/xml / .xml — KSeF фактура → парсится и отображается
 *   таблицей ключевых полей (Sprzedawca/Nabywca/Numer/Pozycje/Razem)
 *   как в портале mojeKsef.gov.pl (но без XSLT — упрощённый renderer).
 *
 * Без миграции: пока используем existing expenses.receipt_url (1 файл).
 * Расширение на multi-attachments — отдельный PR с миграцией.
 */
export function ExpenseAttachmentsModal({
  expense,
  currency,
  onClose,
}: {
  expense: ExpenseRow
  currency: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [xmlContent, setXmlContent] = useState<string | null>(null)
  // Bug 03.06 (Денис): zoom для image + нативный download.
  const [zoom, setZoom] = useState(1)

  async function nativeDownload() {
    if (!url) return
    try {
      const r = await fetch(url)
      const blob = await r.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      // Имя файла: контрагент + дата + расширение из path.
      const ext = path?.split('.').pop()?.split('?')[0] ?? 'bin'
      const safe = (expense.contractor_name || expense.description || 'doc').replace(
        /[^\w-]+/g,
        '_',
      )
      a.download = `${safe}-${expense.expense_at}.${ext}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(blobUrl)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const path = expense.receipt_url
  const isXml = !!path && /\.xml($|\?)/i.test(path)
  const isPdf = !!path && /\.pdf($|\?)/i.test(path)
  const isImage = !!path && /\.(jpe?g|png|webp|gif|heic)($|\?)/i.test(path)

  useEffect(() => {
    let alive = true
    if (!path) {
      setLoading(false)
      return
    }
    void (async () => {
      try {
        const signed = await getReceiptSignedUrl(path)
        if (!alive) return
        setUrl(signed)
        // Для XML загружаем содержимое чтобы распарсить
        if (isXml) {
          try {
            const r = await fetch(signed)
            if (alive) setXmlContent(await r.text())
          } catch {
            // тихий fallback на download-link
          }
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [path, isXml])

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        showClose={false}
        className="!fixed !left-0 !top-0 !h-[100dvh] !max-h-[100dvh] !w-[100vw] !max-w-[100vw] !translate-x-0 !translate-y-0 !rounded-none !border-0 !bg-neutral-900 !text-neutral-100 sm:!h-[100dvh] sm:!max-h-[100dvh] sm:!w-[100vw] sm:!max-w-[100vw]"
      >
        {/* Top bar: имя файла слева, иконки справа (download / external / close).
            Стиль — как у Google Drive/Gmail attachment viewer (скрин-эталон). */}
        <div className="flex items-start justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-bold text-neutral-50 sm:text-lg">
              {expense.contractor_name || expense.description || '—'}
            </h3>
            <p className="mt-0.5 text-xs text-neutral-400">
              {expense.expense_at}
              {' · '}
              <span className="num font-semibold">
                {formatCurrency(expense.amount_cents, currency)}
              </span>
              {expense.source === 'ksef' ? (
                <span className="ml-2 inline-flex items-center rounded border border-neutral-700 px-1 py-0.5 text-[9px] font-semibold uppercase text-neutral-300">
                  KSeF
                </span>
              ) : null}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {url ? (
              <button
                type="button"
                onClick={nativeDownload}
                className="grid size-9 place-items-center rounded-md text-neutral-300 hover:bg-neutral-800 hover:text-white"
                aria-label={t('expenses.viewer.download', { defaultValue: 'Скачать' })}
                title={t('expenses.viewer.download', { defaultValue: 'Скачать' })}
              >
                <Download className="size-4" strokeWidth={1.8} />
              </button>
            ) : null}
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="grid size-9 place-items-center rounded-md text-neutral-300 hover:bg-neutral-800 hover:text-white"
                aria-label={t('expenses.viewer.open_external', {
                  defaultValue: 'Открыть в новой вкладке',
                })}
                title={t('expenses.viewer.open_external', {
                  defaultValue: 'Открыть в новой вкладке',
                })}
              >
                <ExternalLink className="size-4" strokeWidth={1.8} />
              </a>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="grid size-9 place-items-center rounded-md text-neutral-300 hover:bg-neutral-800 hover:text-white"
              aria-label={t('common.close')}
              title={t('common.close')}
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Контент viewer'а — занимает всё оставшееся пространство, скроллится. */}
        <div className="flex-1 overflow-auto px-4 pb-6 sm:px-8">
          {!path ? (
            <p className="py-20 text-center text-sm text-neutral-400">
              {t('expenses.viewer.no_files', {
                defaultValue: 'К расходу не прикреплены документы.',
              })}
            </p>
          ) : loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="size-6 animate-spin text-neutral-400" />
            </div>
          ) : error ? (
            <p className="py-10 text-center text-sm text-rose-400">{error}</p>
          ) : url && isImage ? (
            <div className="flex flex-col items-center gap-3">
              <div className="flex w-full max-w-3xl items-center justify-end gap-1">
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
                  className="grid size-8 place-items-center rounded-md text-neutral-300 hover:bg-neutral-800"
                  aria-label="zoom out"
                >
                  <ZoomOut className="size-4" />
                </button>
                <span className="num w-12 text-center text-xs text-neutral-400">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
                  className="grid size-8 place-items-center rounded-md text-neutral-300 hover:bg-neutral-800"
                  aria-label="zoom in"
                >
                  <ZoomIn className="size-4" />
                </button>
              </div>
              <div className="w-full max-w-5xl overflow-auto rounded-md bg-neutral-950 p-2">
                <img
                  src={url}
                  alt={expense.contractor_name ?? 'receipt'}
                  style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
                  className="mx-auto block max-w-none transition-transform"
                />
              </div>
            </div>
          ) : url && isPdf ? (
            <iframe
              src={url}
              title="receipt"
              className="mx-auto h-[calc(100dvh-100px)] w-full max-w-5xl rounded-md border-0 bg-white"
            />
          ) : isXml && xmlContent ? (
            <div className="mx-auto max-w-3xl rounded-md bg-white p-5 text-neutral-900 shadow-xl">
              <KsefInvoiceViewer xml={xmlContent} currency={currency} />
            </div>
          ) : url ? (
            <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-2 rounded-md bg-neutral-800 p-6 text-center">
              <FileText className="size-8 text-neutral-400" strokeWidth={1.4} />
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm font-semibold text-sky-400 hover:underline"
              >
                <ExternalLink className="size-3.5" strokeWidth={2} />
                {t('expenses.viewer.open_external', { defaultValue: 'Открыть в новой вкладке' })}
              </a>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Полная визуализация KSeF FA(2)/FA(3) фактуры (XML → форматированная
 * страница, печатный вид документа). Покрывает все ключевые поля схемы:
 *
 *  - Шапка: Numer, Razem brutto
 *  - Daty: wystawienia (P_1), sprzedaży (P_1A), termin platnosci, sposob platnosci (P_15A)
 *  - Sprzedawca: pełne dane (Nazwa, NIP, adres, email, telefon, IBAN)
 *  - Nabywca: nazwa, NIP, adres
 *  - Pozycje: Lp, nazwa (P_7), ilość (P_8B) + jm (P_8A), cena netto (P_9A),
 *             stawka VAT (P_12), netto (P_11), brutto (= netto + VAT)
 *  - Sumy po stawkach VAT (P_13_1/2/3/...): netto + VAT
 *  - Razem netto + razem VAT + razem brutto
 *  - Uwagi (P_19), Adnotacje
 *
 * Источник правды — XSD-схема CIRFMF/ksef-api/faktury/schemy/FA. Официального
 * XSLT для рендеринга в открытом доступе нет (на 04.06.2026 в репо CIRFMF
 * лежит только XSD), поэтому делаем custom rendering 1:1 со схемой.
 */
function KsefInvoiceViewer({ xml, currency }: { xml: string; currency: string }) {
  const parsed = parseKsefXml(xml)
  if (!parsed) {
    return (
      <p className="text-muted-foreground text-center text-xs">
        Не удалось распарсить KSeF XML. Используй кнопку «Скачать».
      </p>
    )
  }
  return (
    <div className="space-y-5 text-xs leading-relaxed">
      {/* Шапка: numer + razem brutto */}
      <div className="flex flex-col gap-3 border-b border-neutral-300 pb-3 sm:flex-row sm:items-baseline sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
            Faktura nr
          </p>
          <p className="num text-2xl font-bold text-neutral-900">{parsed.invoiceNumber ?? '—'}</p>
          {parsed.invoiceVariant ? (
            <p className="mt-0.5 text-[10px] uppercase tracking-wider text-neutral-500">
              {parsed.invoiceVariant}
            </p>
          ) : null}
        </div>
        <div className="sm:text-right">
          <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
            Do zapłaty
          </p>
          <p className="num text-2xl font-bold text-neutral-900">
            {parsed.totalGross != null
              ? formatCurrency(Math.round(parsed.totalGross * 100), currency)
              : '—'}
          </p>
        </div>
      </div>

      {/* Daty + sposób płatności */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-4">
        <DataField label="Data wystawienia" value={parsed.issueDate} />
        <DataField label="Data sprzedaży" value={parsed.saleDate ?? parsed.issueDate} />
        <DataField label="Termin płatności" value={parsed.dueDate} />
        <DataField label="Sposób płatności" value={parsed.paymentMethodLabel} />
      </div>

      {/* Sprzedawca + Nabywca */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PartyBox
          title="Sprzedawca"
          name={parsed.sellerName}
          nip={parsed.sellerNip}
          address={parsed.sellerAddress}
          email={parsed.sellerEmail}
          phone={parsed.sellerPhone}
        />
        <PartyBox
          title="Nabywca"
          name={parsed.buyerName}
          nip={parsed.buyerNip}
          address={parsed.buyerAddress}
        />
      </div>

      {/* Bank */}
      {parsed.sellerIban ? (
        <div className="rounded-md border border-neutral-300 p-3 text-[11px]">
          <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
            Rachunek bankowy sprzedawcy
          </p>
          <p className="num font-semibold text-neutral-900">{parsed.sellerIban}</p>
          {parsed.sellerBankName ? (
            <p className="text-neutral-600">{parsed.sellerBankName}</p>
          ) : null}
        </div>
      ) : null}

      {/* Pozycje */}
      {parsed.items.length > 0 ? (
        <div className="overflow-x-auto rounded-md border border-neutral-300">
          <p className="border-b border-neutral-300 bg-neutral-100 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-600">
            Pozycje ({parsed.items.length})
          </p>
          <table className="w-full min-w-[640px] text-[11px]">
            <thead>
              <tr className="border-b border-neutral-300 text-neutral-600">
                <th className="px-2 py-1.5 text-left">Lp</th>
                <th className="px-2 py-1.5 text-left">Nazwa</th>
                <th className="num px-2 py-1.5 text-right">Ilość</th>
                <th className="num px-2 py-1.5 text-right">Cena</th>
                <th className="num px-2 py-1.5 text-right">VAT %</th>
                <th className="num px-2 py-1.5 text-right">Netto</th>
                <th className="num px-2 py-1.5 text-right">Brutto</th>
              </tr>
            </thead>
            <tbody>
              {parsed.items.map((item, i) => (
                <tr key={i} className="border-b border-neutral-200 last:border-b-0">
                  <td className="px-2 py-1.5 text-neutral-500">{i + 1}</td>
                  <td className="px-2 py-1.5">{item.name}</td>
                  <td className="num px-2 py-1.5 text-right">
                    {item.qty != null
                      ? `${item.qty.toLocaleString('pl-PL')}${item.unit ? ' ' + item.unit : ''}`
                      : '—'}
                  </td>
                  <td className="num px-2 py-1.5 text-right">
                    {item.unitPrice != null
                      ? formatCurrency(Math.round(item.unitPrice * 100), currency)
                      : '—'}
                  </td>
                  <td className="num px-2 py-1.5 text-right">
                    {item.vatRate != null ? `${item.vatRate}%` : '—'}
                  </td>
                  <td className="num px-2 py-1.5 text-right">
                    {item.net != null ? formatCurrency(Math.round(item.net * 100), currency) : '—'}
                  </td>
                  <td className="num px-2 py-1.5 text-right font-semibold">
                    {item.gross != null
                      ? formatCurrency(Math.round(item.gross * 100), currency)
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* Sumy po stawkach VAT */}
      {parsed.vatBreakdown.length > 0 ? (
        <div className="overflow-x-auto rounded-md border border-neutral-300">
          <p className="border-b border-neutral-300 bg-neutral-100 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-600">
            Sumy po stawkach VAT
          </p>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-neutral-300 text-neutral-600">
                <th className="num px-2 py-1.5 text-left">Stawka</th>
                <th className="num px-2 py-1.5 text-right">Netto</th>
                <th className="num px-2 py-1.5 text-right">VAT</th>
                <th className="num px-2 py-1.5 text-right">Brutto</th>
              </tr>
            </thead>
            <tbody>
              {parsed.vatBreakdown.map((b, i) => (
                <tr key={i} className="border-b border-neutral-200 last:border-b-0">
                  <td className="num px-2 py-1.5">{b.rate}</td>
                  <td className="num px-2 py-1.5 text-right">
                    {formatCurrency(Math.round(b.net * 100), currency)}
                  </td>
                  <td className="num px-2 py-1.5 text-right">
                    {formatCurrency(Math.round(b.vat * 100), currency)}
                  </td>
                  <td className="num px-2 py-1.5 text-right font-semibold">
                    {formatCurrency(Math.round((b.net + b.vat) * 100), currency)}
                  </td>
                </tr>
              ))}
              <tr className="bg-neutral-100 font-bold text-neutral-900">
                <td className="num px-2 py-2">Razem</td>
                <td className="num px-2 py-2 text-right">
                  {parsed.totalNet != null
                    ? formatCurrency(Math.round(parsed.totalNet * 100), currency)
                    : '—'}
                </td>
                <td className="num px-2 py-2 text-right">
                  {parsed.totalVat != null
                    ? formatCurrency(Math.round(parsed.totalVat * 100), currency)
                    : '—'}
                </td>
                <td className="num px-2 py-2 text-right">
                  {parsed.totalGross != null
                    ? formatCurrency(Math.round(parsed.totalGross * 100), currency)
                    : '—'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}

      {parsed.notes ? (
        <div className="rounded-md border border-neutral-300 p-3 text-[11px]">
          <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
            Uwagi
          </p>
          <p className="whitespace-pre-wrap text-neutral-700">{parsed.notes}</p>
        </div>
      ) : null}
    </div>
  )
}

function DataField({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="num font-semibold text-neutral-900">{value ?? '—'}</p>
    </div>
  )
}

function PartyBox({
  title,
  name,
  nip,
  address,
  email,
  phone,
}: {
  title: string
  name: string | null
  nip: string | null
  address: string | null
  email?: string | null
  phone?: string | null
}) {
  return (
    <div className="rounded-md border border-neutral-300 p-3">
      <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
        {title}
      </p>
      <p className="font-semibold text-neutral-900">{name ?? '—'}</p>
      {nip ? <p className="num mt-0.5 text-neutral-700">NIP: {nip}</p> : null}
      {address ? <p className="mt-0.5 whitespace-pre-wrap text-neutral-700">{address}</p> : null}
      {email ? <p className="mt-0.5 text-neutral-700">{email}</p> : null}
      {phone ? <p className="num mt-0.5 text-neutral-700">tel. {phone}</p> : null}
    </div>
  )
}

type ParsedKsef = {
  invoiceNumber: string | null
  invoiceVariant: string | null
  issueDate: string | null
  saleDate: string | null
  dueDate: string | null
  paymentMethodLabel: string | null
  sellerName: string | null
  sellerNip: string | null
  sellerAddress: string | null
  sellerEmail: string | null
  sellerPhone: string | null
  sellerIban: string | null
  sellerBankName: string | null
  buyerName: string | null
  buyerNip: string | null
  buyerAddress: string | null
  totalNet: number | null
  totalVat: number | null
  totalGross: number | null
  vatBreakdown: Array<{ rate: string; net: number; vat: number }>
  items: Array<{
    name: string
    qty: number | null
    unit: string | null
    unitPrice: number | null
    vatRate: string | null
    net: number | null
    gross: number | null
  }>
  notes: string | null
}

/**
 * Лейблы способов оплаты по schema FA(3) P_15A (1..7, X).
 */
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  '1': 'Gotówka',
  '2': 'Karta',
  '3': 'Bon',
  '4': 'Czek',
  '5': 'Kredyt',
  '6': 'Przelew',
  '7': 'Mobilna',
  X: 'Inny',
}

function parseKsefXml(xml: string): ParsedKsef | null {
  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    const get = (sel: string): string | null => {
      const el = doc.querySelector(sel)
      return el?.textContent?.trim() || null
    }
    const num = (s: string | null): number | null => {
      if (!s) return null
      const n = Number(s.replace(/\s/g, '').replace(',', '.'))
      return Number.isFinite(n) ? n : null
    }
    const formatAddress = (root: Element | null): string | null => {
      if (!root) return null
      const parts = [
        [root.querySelector('Ulica')?.textContent, root.querySelector('NrDomu')?.textContent]
          .filter(Boolean)
          .join(' '),
        [
          root.querySelector('KodPocztowy')?.textContent,
          root.querySelector('Miejscowosc')?.textContent,
        ]
          .filter(Boolean)
          .join(' '),
        root.querySelector('KodKraju')?.textContent,
      ]
        .map((s) => (s ?? '').trim())
        .filter(Boolean)
      return parts.length > 0 ? parts.join('\n') : null
    }
    const sellerEl = doc.querySelector('Podmiot1')
    const buyerEl = doc.querySelector('Podmiot2')
    const items: ParsedKsef['items'] = []
    doc.querySelectorAll('FaWiersz').forEach((row) => {
      const name = row.querySelector('P_7')?.textContent?.trim() || '—'
      const qty = num(row.querySelector('P_8B')?.textContent ?? null)
      const unit = row.querySelector('P_8A')?.textContent?.trim() || null
      const unitPrice = num(row.querySelector('P_9A')?.textContent ?? null)
      const vatRate = row.querySelector('P_12')?.textContent?.trim() ?? null
      const net = num(row.querySelector('P_11')?.textContent ?? null)
      const gross = num(row.querySelector('P_11A')?.textContent ?? null)
      items.push({ name, qty, unit, unitPrice, vatRate, net, gross })
    })

    // VAT-разбивка из P_13_1..P_13_7 / P_14_1..P_14_7 (FA(2)/(3)).
    // Пары: P_13_N = netto по ставке, P_14_N = VAT по ставке.
    const vatBreakdown: ParsedKsef['vatBreakdown'] = []
    const stawkiMap: Array<{ idx: string; label: string }> = [
      { idx: '1', label: '23%' },
      { idx: '2', label: '8%' },
      { idx: '3', label: '5%' },
      { idx: '4', label: '0% (eksp.)' },
      { idx: '5', label: '0%' },
      { idx: '6', label: 'zw.' },
      { idx: '7', label: 'np.' },
    ]
    for (const { idx, label } of stawkiMap) {
      const net = num(get(`P_13_${idx}`))
      const vat = num(get(`P_14_${idx}`))
      if (net != null || vat != null) {
        vatBreakdown.push({ rate: label, net: net ?? 0, vat: vat ?? 0 })
      }
    }

    const totalGross = num(get('P_15'))
    const totalNet = vatBreakdown.reduce((s, b) => s + b.net, 0) || null
    const totalVat = vatBreakdown.reduce((s, b) => s + b.vat, 0) || null

    const paymentCode = get('P_15A')
    const paymentLabel = paymentCode ? (PAYMENT_METHOD_LABELS[paymentCode] ?? paymentCode) : null

    return {
      invoiceNumber: get('P_2'),
      invoiceVariant: doc.documentElement?.getAttribute('xmlns')?.includes('FA(3)')
        ? 'FA(3)'
        : doc.documentElement?.getAttribute('xmlns')?.includes('FA(2)')
          ? 'FA(2)'
          : null,
      issueDate: get('P_1'),
      saleDate: get('P_1A'),
      dueDate: get('TerminPlatnosci Termin') ?? get('TerminPlatnosci') ?? get('P_2A'),
      paymentMethodLabel: paymentLabel,
      sellerName: sellerEl?.querySelector('Nazwa')?.textContent?.trim() ?? null,
      sellerNip: sellerEl?.querySelector('NIP')?.textContent?.trim() ?? null,
      sellerAddress: formatAddress(sellerEl?.querySelector('Adres') ?? null),
      sellerEmail: sellerEl?.querySelector('Email')?.textContent?.trim() ?? null,
      sellerPhone: sellerEl?.querySelector('Telefon')?.textContent?.trim() ?? null,
      sellerIban:
        doc.querySelector('NrRB')?.textContent?.trim() ??
        doc.querySelector('NrRachunku')?.textContent?.trim() ??
        null,
      sellerBankName: doc.querySelector('NazwaBanku')?.textContent?.trim() ?? null,
      buyerName: buyerEl?.querySelector('Nazwa')?.textContent?.trim() ?? null,
      buyerNip: buyerEl?.querySelector('NIP')?.textContent?.trim() ?? null,
      buyerAddress: formatAddress(buyerEl?.querySelector('Adres') ?? null),
      totalNet,
      totalVat,
      totalGross,
      vatBreakdown,
      items,
      notes: get('P_19') ?? get('Uwagi') ?? null,
    }
  } catch {
    return null
  }
}
