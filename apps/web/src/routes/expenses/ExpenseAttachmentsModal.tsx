import { Download, ExternalLink, FileText, Loader2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
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
      <DialogContent className="sm:!max-w-3xl">
        <div className="border-border flex items-start justify-between gap-3 border-b px-5 py-3">
          <div className="min-w-0">
            <h3 className="text-foreground truncate text-sm font-bold">
              {expense.contractor_name || expense.description || '—'}
            </h3>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {expense.expense_at}
              {' · '}
              <span className="num font-semibold">
                {formatCurrency(expense.amount_cents, currency)}
              </span>
              {expense.source === 'ksef' ? (
                <span className="border-border text-muted-foreground ml-2 inline-flex items-center rounded border px-1 py-0.5 text-[9px] font-semibold uppercase">
                  KSeF
                </span>
              ) : null}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground rounded-md p-1"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="max-h-[70vh] min-h-[300px] overflow-y-auto px-5 py-4">
          {!path ? (
            <p className="text-muted-foreground text-center text-sm">
              {t('expenses.viewer.no_files', {
                defaultValue: 'К расходу не прикреплены документы.',
              })}
            </p>
          ) : loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="text-muted-foreground size-6 animate-spin" />
            </div>
          ) : error ? (
            <p className="text-destructive text-sm">{error}</p>
          ) : url && isImage ? (
            <img
              src={url}
              alt={expense.contractor_name ?? 'receipt'}
              className="border-border mx-auto max-h-[60vh] rounded-md border object-contain"
            />
          ) : url && isPdf ? (
            <iframe
              src={url}
              title="receipt"
              className="border-border h-[60vh] w-full rounded-md border"
            />
          ) : isXml && xmlContent ? (
            <KsefInvoiceViewer xml={xmlContent} currency={currency} />
          ) : url ? (
            <div className="border-border bg-muted/30 flex flex-col items-center justify-center gap-2 rounded-md border p-6 text-center">
              <FileText className="text-muted-foreground size-8" strokeWidth={1.4} />
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-teal-deep inline-flex items-center gap-1 text-sm font-semibold hover:underline"
              >
                <ExternalLink className="size-3.5" strokeWidth={2} />
                {t('expenses.viewer.open_external', { defaultValue: 'Открыть в новой вкладке' })}
              </a>
            </div>
          ) : null}
        </div>

        <div className="border-border flex items-center justify-end gap-2 border-t px-5 py-3">
          {url ? (
            <a
              href={url}
              download
              target="_blank"
              rel="noopener noreferrer"
              className="border-border bg-card hover:bg-muted/40 inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-semibold"
            >
              <Download className="size-3.5" strokeWidth={2} />
              {t('expenses.viewer.download', { defaultValue: 'Скачать' })}
            </a>
          ) : null}
          <Button variant="outline" size="sm" onClick={onClose}>
            {t('common.close')}
          </Button>
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
