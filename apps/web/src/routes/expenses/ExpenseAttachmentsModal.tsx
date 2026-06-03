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
 * Упрощённая визуализация KSeF фактуры (XML → таблица ключевых полей).
 * KSeF не публикует API для PDF-визуализации — нужно либо XSLT, либо
 * custom rendering. Здесь делаем custom для основных полей FA(2)/FA(3)
 * схемы: Numer, Daty, Sprzedawca, Nabywca, Pozycje, Suma brutto.
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
    <div className="space-y-4 text-xs">
      <div className="border-border flex flex-wrap items-baseline justify-between gap-2 border-b pb-2">
        <div>
          <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider">
            Numer faktury
          </p>
          <p className="num text-foreground text-base font-bold">{parsed.invoiceNumber ?? '—'}</p>
        </div>
        <div className="text-right">
          <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider">
            Razem brutto
          </p>
          <p className="num text-foreground text-base font-bold">
            {parsed.totalGross != null
              ? formatCurrency(Math.round(parsed.totalGross * 100), currency)
              : '—'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="border-border rounded-md border p-3">
          <p className="text-muted-foreground mb-1 text-[10px] font-bold uppercase tracking-wider">
            Sprzedawca
          </p>
          <p className="text-foreground font-semibold">{parsed.sellerName ?? '—'}</p>
          {parsed.sellerNip ? (
            <p className="text-muted-foreground num mt-0.5">NIP: {parsed.sellerNip}</p>
          ) : null}
        </div>
        <div className="border-border rounded-md border p-3">
          <p className="text-muted-foreground mb-1 text-[10px] font-bold uppercase tracking-wider">
            Nabywca
          </p>
          <p className="text-foreground font-semibold">{parsed.buyerName ?? '—'}</p>
          {parsed.buyerNip ? (
            <p className="text-muted-foreground num mt-0.5">NIP: {parsed.buyerNip}</p>
          ) : null}
        </div>
      </div>

      <div className="border-border rounded-md border p-3">
        <p className="text-muted-foreground mb-1 text-[10px] font-bold uppercase tracking-wider">
          Daty
        </p>
        <p>
          Wystawienia: <span className="num">{parsed.issueDate ?? '—'}</span>
          {parsed.dueDate ? (
            <span className="text-muted-foreground ml-3">
              · Termin: <span className="num">{parsed.dueDate}</span>
            </span>
          ) : null}
        </p>
      </div>

      {parsed.items.length > 0 ? (
        <div className="border-border overflow-hidden rounded-md border">
          <p className="text-muted-foreground border-border bg-muted/30 border-b px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider">
            Pozycje
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-border border-b">
                <th className="px-3 py-1.5 text-left">Nazwa</th>
                <th className="num px-3 py-1.5 text-right">Brutto</th>
              </tr>
            </thead>
            <tbody>
              {parsed.items.map((item, i) => (
                <tr key={i} className="border-border/40 border-b last:border-b-0">
                  <td className="px-3 py-1.5">{item.name}</td>
                  <td className="num px-3 py-1.5 text-right">
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
    </div>
  )
}

type ParsedKsef = {
  invoiceNumber: string | null
  issueDate: string | null
  dueDate: string | null
  sellerName: string | null
  sellerNip: string | null
  buyerName: string | null
  buyerNip: string | null
  totalGross: number | null
  items: Array<{ name: string; gross: number | null }>
}

function parseKsefXml(xml: string): ParsedKsef | null {
  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    const get = (sel: string): string | null => {
      const el = doc.querySelector(sel)
      return el?.textContent?.trim() || null
    }
    const items: ParsedKsef['items'] = []
    doc.querySelectorAll('FaWiersz').forEach((row) => {
      const name = row.querySelector('P_7')?.textContent?.trim() || '—'
      const grossStr = row.querySelector('P_11A, P_11')?.textContent?.trim() ?? null
      items.push({ name, gross: grossStr ? Number(grossStr.replace(',', '.')) : null })
    })
    const totalStr = get('P_15')
    return {
      invoiceNumber: get('P_2'),
      issueDate: get('P_1'),
      dueDate: get('TerminPlatnosci') ?? get('P_2A'),
      sellerName: get('Podmiot1 Nazwa') ?? get('Sprzedawca Nazwa'),
      sellerNip: get('Podmiot1 NIP') ?? get('Sprzedawca NIP'),
      buyerName: get('Podmiot2 Nazwa') ?? get('Nabywca Nazwa'),
      buyerNip: get('Podmiot2 NIP') ?? get('Nabywca NIP'),
      totalGross: totalStr ? Number(totalStr.replace(',', '.')) : null,
      items,
    }
  } catch {
    return null
  }
}
