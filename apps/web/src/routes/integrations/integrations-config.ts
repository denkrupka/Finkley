import type { LucideIcon } from 'lucide-react'
import { Calendar, CalendarCheck, CalendarClock, CalendarPlus, FileText } from 'lucide-react'

/**
 * Каталог интеграций. Источник истины — этот файл; страница и формы
 * рендерят карточки/диалоги отсюда. Когда будем добавлять новую
 * интеграцию — кладём сюда + создаём connect-form-template.
 *
 * Поля статус/last_sync идут из БД (TASK-29 sync), пока — только визуал.
 */

export type IntegrationProvider = 'booksy' | 'fresha' | 'treatwell' | 'yclients' | 'wfirma'

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
  description_key: string // i18n key
  icon: LucideIcon
  brandColor: string
  /** Поля connect-формы. Сейчас только UI, потом — сохранение в salon_integrations. */
  connectFields: ConnectField[]
  /** Доступна для подключения сейчас, или «скоро». */
  status: 'available' | 'coming_soon' | 'in_research'
}

export const INTEGRATIONS: IntegrationDef[] = [
  {
    id: 'booksy',
    name: 'Booksy',
    region: 'PL · EU',
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
    status: 'coming_soon',
  },
  {
    id: 'treatwell',
    name: 'Treatwell',
    region: 'UK · EU',
    description_key: 'integrations.providers.treatwell.description',
    icon: CalendarClock,
    brandColor: '#7C3AED',
    connectFields: [
      { key: 'login', label_key: 'integrations.fields.email', type: 'email', required: true },
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
    id: 'wfirma',
    name: 'wFirma',
    region: 'PL',
    description_key: 'integrations.providers.wfirma.description',
    icon: FileText,
    brandColor: '#1976D2',
    // connectFields не используются — у wFirma свой Hybrid-диалог
    // (auto-login email+password ИЛИ ручной ввод 3 ключей).
    connectFields: [],
    status: 'available',
  },
  {
    id: 'yclients',
    name: 'YCLIENTS',
    region: 'UA · RU · KZ',
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
]
