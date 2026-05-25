/**
 * Генератор SEPA Credit Transfer Initiation XML (pain.001.001.03) для
 * массовой выгрузки переводов в банк. Принимается практически всеми
 * европейскими банками: PKO, Santander, ING, mBank, Millennium, Pekao,
 * Citi, Alior, BNP Paribas, Crédit Agricole.
 *
 * Спека: https://www.iso20022.org/iso-20022-message-definitions
 *
 * Пример использования:
 *   const xml = buildSepaXml({
 *     debtorName: 'My Salon Sp. z o.o.',
 *     debtorIban: 'PL61109010140000071219812874',
 *     executionDate: '2026-05-27',
 *     payments: [
 *       { endToEndId: 'PAY-1', amountCents: 12345, currency: 'PLN',
 *         creditorName: 'Vendor 1', creditorIban: 'PL...', remittance: 'Faktura 1' },
 *     ],
 *   })
 *   downloadFile('transfers.xml', xml, 'application/xml')
 */

import { normalizeIban } from './iban'

export type SepaPayment = {
  endToEndId: string // уникальный id перевода (макс 35 символов)
  amountCents: number
  currency: string // 'PLN' / 'EUR' / 'USD'
  creditorName: string
  creditorIban: string
  remittance: string // Tytuł / назначение платежа (макс 140 символов)
}

export type SepaInput = {
  debtorName: string
  debtorIban: string
  /** ISO date YYYY-MM-DD когда исполнить. По умолчанию — следующий банк-день. */
  executionDate: string
  payments: SepaPayment[]
  /** Опциональный BIC дебитора. Если не задан — банк подставит сам. */
  debtorBic?: string
}

/** Escape для XML текста (вместо HTML библиотеки). */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Конвертер cents в decimal string с 2 знаками: 12345 → "123.45". */
function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const whole = Math.floor(abs / 100)
  const frac = String(abs % 100).padStart(2, '0')
  return `${sign}${whole}.${frac}`
}

/** ISO 8601 datetime для CreDtTm (без миллисекунд, как требует pain.001). */
function isoNowSeconds(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** Уникальный msg id: SALON-{timestamp}. Banks expect ≤ 35 chars. */
function generateMsgId(prefix: string): string {
  const ts = Date.now().toString(36).toUpperCase()
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase()
  return `${prefix.slice(0, 12)}-${ts}-${rand}`.slice(0, 35)
}

export function buildSepaXml(input: SepaInput): string {
  if (input.payments.length === 0) throw new Error('Need at least one payment')
  const debtorIban = normalizeIban(input.debtorIban)
  if (!debtorIban) throw new Error('Debtor IBAN missing')

  const msgId = generateMsgId('FINKLEY')
  const pmtInfId = `BATCH-${msgId.slice(-12)}`
  const nbOfTxs = input.payments.length
  const ctrlSumCents = input.payments.reduce((s, p) => s + p.amountCents, 0)
  const ctrlSum = centsToDecimal(ctrlSumCents)

  // Группируем по валюте — pain.001 разрешает только одну валюту на PmtInf.
  // Если в выборке смешанные валюты — делаем несколько PmtInf блоков.
  const byCurrency = new Map<string, SepaPayment[]>()
  for (const p of input.payments) {
    const list = byCurrency.get(p.currency) ?? []
    list.push(p)
    byCurrency.set(p.currency, list)
  }

  const pmtInfBlocks = [...byCurrency.entries()]
    .map(([currency, payments], blockIdx) => {
      const subSum = centsToDecimal(payments.reduce((s, p) => s + p.amountCents, 0))
      const txBlocks = payments
        .map((p) => {
          const creditorIban = normalizeIban(p.creditorIban)
          if (!creditorIban) throw new Error(`Creditor IBAN missing for ${p.endToEndId}`)
          return `      <CdtTrfTxInf>
        <PmtId><EndToEndId>${xmlEscape(p.endToEndId).slice(0, 35)}</EndToEndId></PmtId>
        <Amt><InstdAmt Ccy="${xmlEscape(currency)}">${centsToDecimal(p.amountCents)}</InstdAmt></Amt>
        <Cdtr><Nm>${xmlEscape(p.creditorName).slice(0, 140)}</Nm></Cdtr>
        <CdtrAcct><Id><IBAN>${xmlEscape(creditorIban)}</IBAN></Id></CdtrAcct>
        <RmtInf><Ustrd>${xmlEscape(p.remittance).slice(0, 140)}</Ustrd></RmtInf>
      </CdtTrfTxInf>`
        })
        .join('\n')

      return `    <PmtInf>
      <PmtInfId>${xmlEscape(pmtInfId)}-${blockIdx + 1}</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <NbOfTxs>${payments.length}</NbOfTxs>
      <CtrlSum>${subSum}</CtrlSum>
      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>
      <ReqdExctnDt>${xmlEscape(input.executionDate)}</ReqdExctnDt>
      <Dbtr><Nm>${xmlEscape(input.debtorName).slice(0, 140)}</Nm></Dbtr>
      <DbtrAcct><Id><IBAN>${xmlEscape(debtorIban)}</IBAN></Id></DbtrAcct>
      ${input.debtorBic ? `<DbtrAgt><FinInstnId><BIC>${xmlEscape(input.debtorBic)}</BIC></FinInstnId></DbtrAgt>` : ''}
      <ChrgBr>SLEV</ChrgBr>
${txBlocks}
    </PmtInf>`
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${xmlEscape(msgId)}</MsgId>
      <CreDtTm>${isoNowSeconds()}</CreDtTm>
      <NbOfTxs>${nbOfTxs}</NbOfTxs>
      <CtrlSum>${ctrlSum}</CtrlSum>
      <InitgPty><Nm>${xmlEscape(input.debtorName).slice(0, 140)}</Nm></InitgPty>
    </GrpHdr>
${pmtInfBlocks}
  </CstmrCdtTrfInitn>
</Document>
`
}

/** Helper: триггерит скачивание файла в браузере. */
export function downloadFile(filename: string, content: string, mime = 'application/xml') {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Список поддерживаемых форматов экспорта. Сейчас один — SEPA XML, который
 * принимают все EU банки. В будущем сюда добавятся PL-специфичные форматы
 * (Elixir-O для PKO/Santander, MT940 для устаревших, банк-CSV для retail).
 */
export type ExportFormat = 'sepa-xml'

export const EXPORT_FORMATS: Array<{
  id: ExportFormat
  labelKey: string
  extension: string
  mime: string
}> = [
  {
    id: 'sepa-xml',
    labelKey: 'banking.export.format.sepa_xml',
    extension: 'xml',
    mime: 'application/xml',
  },
]
