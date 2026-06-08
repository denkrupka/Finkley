import type { LucideIcon } from 'lucide-react'
import {
  Calendar,
  CalendarCheck,
  CalendarClock,
  CalendarPlus,
  FileText,
  Receipt,
  ScrollText,
  ShieldCheck,
} from 'lucide-react'

/**
 * Каталог интеграций. Источник истины — этот файл; страница и формы
 * рендерят карточки/диалоги отсюда. Когда добавляем новую интеграцию —
 * кладём сюда + создаём connect-form-template (и/или dedicated dialog).
 *
 * Категории нужны чтобы UI на /integrations группировал карточки в секции
 * и юзер не путался: «бухгалтерия отдельно от записи отдельно от банка».
 */

export type IntegrationProvider =
  | 'booksy'
  | 'fresha'
  | 'treatwell'
  | 'yclients'
  | 'bookon'
  | 'wfirma'
  | 'fakturownia'
  | 'infakt'
  | 'ksef'

export type IntegrationCategory =
  | 'accounting'
  | 'booking'
  | 'banking'
  | 'messengers'
  | 'sms'
  | 'social'
  | 'other'

export type ConnectField = {
  key: string
  label_key: string // i18n key
  type: 'text' | 'password' | 'email'
  placeholder_key?: string
  required?: boolean
}

export type IntegrationDef = {
  id: IntegrationProvider
  name: string
  region: string // PL / EU / UA-RU
  category: IntegrationCategory
  description_key: string // i18n key
  icon: LucideIcon
  brandColor: string
  /** Поля connect-формы. Сейчас только UI, потом — сохранение в salon_integrations. */
  connectFields: ConnectField[]
  /** Доступна для подключения сейчас, или «скоро». */
  status: 'available' | 'coming_soon' | 'in_research'
}

export const INTEGRATIONS: IntegrationDef[] = [
  // -------- Бухгалтерия и фактуры --------
  {
    id: 'wfirma',
    name: 'wFirma',
    region: 'PL',
    category: 'accounting',
    description_key: 'integrations.providers.wfirma.description',
    icon: FileText,
    brandColor: '#1976D2',
    // connectFields не используются — у wFirma свой Hybrid-диалог
    // (auto-login email+password ИЛИ ручной ввод 3 ключей).
    connectFields: [],
    status: 'available',
  },
  {
    id: 'ksef',
    name: 'KSeF',
    region: 'PL',
    category: 'accounting',
    description_key: 'integrations.providers.ksef.description',
    icon: ShieldCheck,
    brandColor: '#8B0000',
    // KSeF connectFields — токен из «Mój KSeF» + environment.
    // Используется ConnectIntegrationDialog (универсальный) с этими полями.
    connectFields: [
      {
        key: 'nip',
        label_key: 'integrations.fields.ksef_nip',
        type: 'text',
        required: true,
      },
      {
        key: 'token',
        label_key: 'integrations.fields.ksef_token',
        type: 'password',
        required: true,
      },
    ],
    status: 'available',
  },
  {
    id: 'fakturownia',
    name: 'Fakturownia',
    region: 'PL',
    category: 'accounting',
    description_key: 'integrations.providers.fakturownia.description',
    icon: Receipt,
    brandColor: '#0EA5E9',
    connectFields: [
      {
        key: 'subdomain',
        label_key: 'integrations.fields.fakturownia_subdomain',
        type: 'text',
        required: true,
      },
      {
        key: 'api_token',
        label_key: 'integrations.fields.fakturownia_api_token',
        type: 'password',
        required: true,
      },
    ],
    status: 'available',
  },
  {
    id: 'infakt',
    name: 'inFakt',
    region: 'PL',
    category: 'accounting',
    description_key: 'integrations.providers.infakt.description',
    icon: ScrollText,
    brandColor: '#EAB308',
    connectFields: [
      {
        key: 'api_token',
        label_key: 'integrations.fields.infakt_api_token',
        type: 'password',
        required: true,
      },
    ],
    // Требует партнёрского доступа inFakt — на этапе подачи заявки.
    status: 'in_research',
  },

  // -------- Запись и календарь --------
  {
    id: 'booksy',
    name: 'Booksy',
    region: 'PL · EU',
    category: 'booking',
    description_key: 'integrations.providers.booksy.description',
    icon: CalendarCheck,
    brandColor: '#0ABAB5',
    connectFields: [
      {
        key: 'login',
        label_key: 'integrations.fields.email_or_phone',
        type: 'email',
        required: true,
      },
      {
        key: 'password',
        label_key: 'integrations.fields.password',
        type: 'password',
        required: true,
      },
    ],
    status: 'available',
  },
  {
    id: 'fresha',
    name: 'Fresha',
    region: 'UK · EU · US',
    category: 'booking',
    description_key: 'integrations.providers.fresha.description',
    icon: Calendar,
    brandColor: '#FF6B35',
    connectFields: [
      { key: 'login', label_key: 'integrations.fields.email', type: 'email', required: true },
      {
        key: 'password',
        label_key: 'integrations.fields.password',
        type: 'password',
        required: true,
      },
    ],
    status: 'available',
  },
  {
    id: 'treatwell',
    name: 'Treatwell',
    region: 'UK · EU',
    category: 'booking',
    description_key: 'integrations.providers.treatwell.description',
    icon: CalendarClock,
    brandColor: '#7C3AED',
    // Авто-логин через Capsolver на GitHub-воркере (treatwell-connect →
    // treatwell-sync). Капчу Cloudflare решает Capsolver, логин идёт с IP
    // GitHub (Supabase Edge Cloudflare режет).
    connectFields: [
      { key: 'login', label_key: 'integrations.fields.email', type: 'email', required: true },
      {
        key: 'password',
        label_key: 'integrations.fields.password',
        type: 'password',
        required: true,
      },
    ],
    status: 'available',
  },
  {
    id: 'yclients',
    name: 'YCLIENTS',
    region: 'UA · RU · KZ',
    category: 'booking',
    description_key: 'integrations.providers.yclients.description',
    icon: CalendarPlus,
    brandColor: '#3B82F6',
    connectFields: [
      {
        key: 'login',
        label_key: 'integrations.fields.email_or_phone',
        type: 'email',
        required: true,
      },
      {
        key: 'password',
        label_key: 'integrations.fields.password',
        type: 'password',
        required: true,
      },
    ],
    status: 'coming_soon',
  },
  {
    // Bug 5059189d (Елена 01.06): BookOn (bookon.binotel.pl) — booking-
    // система от Binotel для салонов в PL/UA. Public API не задокументирован
    // — connect-flow сохраняет credentials в salon_integrations.credentials
    // (server-side encryption), sync пока возвращает {ok:true, stats:0} до
    // реализации pull-логики. Когда будет известна структура их API —
    // расширить bookon-proxy/sync.
    id: 'bookon',
    name: 'BookOn',
    region: 'PL · UA',
    category: 'booking',
    description_key: 'integrations.providers.bookon.description',
    icon: CalendarCheck,
    brandColor: '#FF7A00',
    connectFields: [
      {
        key: 'login',
        label_key: 'integrations.fields.email_or_phone',
        type: 'email',
        required: true,
      },
      {
        key: 'password',
        label_key: 'integrations.fields.password',
        type: 'password',
        required: true,
      },
    ],
    status: 'available',
  },
]

// Порядок (по требованию владельца, 2026-05-15):
//   Запись и календарь → Бухгалтерия и фактуры → Мессенджеры →
//   Банкинг → Прочее.
export const CATEGORY_ORDER: IntegrationCategory[] = [
  'booking',
  'accounting',
  'messengers',
  'sms',
  'banking',
  'other',
]

export function getCategoryLabel(category: IntegrationCategory): string {
  return `integrations.categories.${category}`
}

export function getCategorySubtitle(category: IntegrationCategory): string {
  return `integrations.categories.${category}_subtitle`
}
