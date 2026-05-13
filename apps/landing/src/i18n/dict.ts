/**
 * Словари локализаций лендинга.
 *
 * Astro строит статику для русского (дефолт). Английский/польский живут
 * как client-side переключатель: на первой загрузке JS читает localStorage
 * (`finkley.lang`) и подменяет тексты в элементах `[data-i18n="..."]` через
 * dictionary. Это не SEO-friendly для EN/PL (Google индексирует только RU
 * статику), но даёт быструю мультиязычность для пользователей.
 *
 * SEO-friendly multilingual через `[lang]/index.astro` routes — отдельная
 * задача (TODO docs/landing-seo-i18n.md).
 */

export type Lang = 'ru' | 'en' | 'pl'

export const LANGS: { code: Lang; label: string; flag: string }[] = [
  { code: 'ru', label: 'Русский', flag: '🇷🇺' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'pl', label: 'Polski', flag: '🇵🇱' },
]

export type DictKey =
  // Nav + CTA
  | 'nav.product'
  | 'nav.features'
  | 'nav.pricing'
  | 'nav.media'
  | 'nav.login'
  | 'nav.signup'
  // Hero
  | 'hero.tagline'
  | 'hero.title'
  | 'hero.subtitle'
  | 'hero.cta_primary'
  | 'hero.cta_secondary'
  // Sections
  | 'features.title'
  | 'features.subtitle'
  | 'features.finance.title'
  | 'features.finance.body'
  | 'features.messenger.title'
  | 'features.messenger.body'
  | 'features.ai.title'
  | 'features.ai.body'
  | 'features.integrations.title'
  | 'features.integrations.body'
  | 'features.security.title'
  | 'features.security.body'
  | 'features.booking.title'
  | 'features.booking.body'
  // Footer
  | 'footer.privacy'
  | 'footer.terms'
  | 'footer.contact'
  | 'footer.rights'

export const dict: Record<Lang, Record<DictKey, string>> = {
  ru: {
    'nav.product': 'О продукте',
    'nav.features': 'Возможности',
    'nav.pricing': 'Цены',
    'nav.media': 'Медиа',
    'nav.login': 'Войти',
    'nav.signup': 'Начать бесплатно',
    'hero.tagline': 'Управленческий учёт для салонов красоты',
    'hero.title': 'Видишь свою прибыль, а не только запись клиентов',
    'hero.subtitle':
      'Finkley собирает деньги, визиты, расходы и сообщения от клиентов в один экран. Считает прибыль каждый день — без бухгалтера и Excel-таблиц.',
    'hero.cta_primary': 'Начать бесплатно — 14 дней',
    'hero.cta_secondary': 'Посмотреть демо',
    'features.title': 'Всё что нужно салону — в одном продукте',
    'features.subtitle':
      'Меньше переключений между приложениями, больше времени на клиентов и принятие решений.',
    'features.finance.title': 'Финансы по дням, неделям, месяцам',
    'features.finance.body':
      'Выручка, расходы, ФОТ, налоги, чистая прибыль — автоматически из визитов и чеков. Графики Cash Flow, P&L и DDS, как у большого бизнеса, без головной боли.',
    'features.messenger.title': 'Единый мессенджер',
    'features.messenger.body':
      'Сообщения из Facebook, Instagram, Telegram и WhatsApp приходят в один центр прямо в портале. Видишь имя и аватарку клиента, привязка к карточке в базе, быстрая запись на визит — всё одной кнопкой.',
    'features.ai.title': 'AI-помощник и OCR чеков',
    'features.ai.body':
      'Сфотографируй чек или инвойс — Finkley распознает суммы, дату, поставщика, NIP и сам разнесёт по статьям расходов. AI-помощник отвечает на вопросы о прибыли, маржинальности услуг и нагрузке мастеров.',
    'features.integrations.title': 'Интеграции c важными сервисами',
    'features.integrations.body':
      'Booksy, wFirma, KSeF, Fakturownia, iFirma, inFakt, 360Księgowość, Stripe, банки PSD2 (Open Banking) — настраиваешь раз и забываешь.',
    'features.security.title': 'Безопасность как в банке',
    'features.security.body':
      'Все токены интеграций шифруются на сервере AES-256-GCM, данные изолированы по салонам через Row-Level Security в Postgres. Twoja firma — twoje dane.',
    'features.booking.title': 'Календарь и онлайн-запись',
    'features.booking.body':
      'Двусторонняя синхронизация с Booksy. iCal-фид для подключения Google Calendar/Apple Calendar мастера. Резерв слота из Finkley → блокировка в Booksy автоматом.',
    'footer.privacy': 'Privacy',
    'footer.terms': 'Terms',
    'footer.contact': 'Связаться',
    'footer.rights': '© 2026 Finkley. Все права защищены.',
  },
  en: {
    'nav.product': 'Product',
    'nav.features': 'Features',
    'nav.pricing': 'Pricing',
    'nav.media': 'Blog',
    'nav.login': 'Sign in',
    'nav.signup': 'Start free',
    'hero.tagline': 'Management accounting for beauty salons',
    'hero.title': 'See your profit, not just the appointment book',
    'hero.subtitle':
      'Finkley brings revenue, expenses, visits and client messages into one screen. Calculates daily profit — no accountant or spreadsheets needed.',
    'hero.cta_primary': 'Start free — 14 days',
    'hero.cta_secondary': 'Watch demo',
    'features.title': 'Everything your salon needs — in one product',
    'features.subtitle': 'Less app-switching, more time for clients and better decisions.',
    'features.finance.title': 'Finance by day, week, month',
    'features.finance.body':
      'Revenue, expenses, payroll, taxes, net profit — automatically from visits and receipts. Cash Flow, P&L and DDS charts like a big business, without the headache.',
    'features.messenger.title': 'Unified messenger',
    'features.messenger.body':
      'Messages from Facebook, Instagram, Telegram and WhatsApp arrive in one inbox right in the portal. See client name and avatar, link to the customer card in your database, quick booking — all with one button.',
    'features.ai.title': 'AI assistant and receipt OCR',
    'features.ai.body':
      'Snap a receipt or invoice — Finkley reads amounts, date, supplier, tax ID and books it to the right expense category. AI answers questions about profit, service margins and staff load.',
    'features.integrations.title': 'Integrations with the tools you use',
    'features.integrations.body':
      'Booksy, wFirma, KSeF, Fakturownia, iFirma, inFakt, 360Księgowość, Stripe, PSD2 Open Banking — set it up once and forget.',
    'features.security.title': 'Bank-grade security',
    'features.security.body':
      'All integration tokens are encrypted on the server with AES-256-GCM. Data is isolated per salon via Postgres Row-Level Security. Your business — your data.',
    'features.booking.title': 'Calendar and online booking',
    'features.booking.body':
      'Two-way sync with Booksy. iCal feed for Google Calendar / Apple Calendar of each staff member. Reserve a slot in Finkley → it gets blocked in Booksy automatically.',
    'footer.privacy': 'Privacy',
    'footer.terms': 'Terms',
    'footer.contact': 'Contact',
    'footer.rights': '© 2026 Finkley. All rights reserved.',
  },
  pl: {
    'nav.product': 'O produkcie',
    'nav.features': 'Funkcje',
    'nav.pricing': 'Cennik',
    'nav.media': 'Blog',
    'nav.login': 'Zaloguj się',
    'nav.signup': 'Zacznij za darmo',
    'hero.tagline': 'Rachunkowość zarządcza dla salonów urody',
    'hero.title': 'Zobacz swój zysk, a nie tylko kalendarz wizyt',
    'hero.subtitle':
      'Finkley łączy przychody, wydatki, wizyty i wiadomości od klientów w jednym ekranie. Liczy zysk każdego dnia — bez księgowego i Excela.',
    'hero.cta_primary': 'Zacznij za darmo — 14 dni',
    'hero.cta_secondary': 'Zobacz demo',
    'features.title': 'Wszystko, co potrzebuje salon — w jednym produkcie',
    'features.subtitle': 'Mniej przełączania między aplikacjami, więcej czasu dla klientów.',
    'features.finance.title': 'Finanse dzień po dniu, tydzień po tygodniu',
    'features.finance.body':
      'Przychody, wydatki, wynagrodzenia, podatki, zysk netto — automatycznie z wizyt i paragonów. Cash Flow, P&L i DDS jak w dużej firmie, bez bólu głowy.',
    'features.messenger.title': 'Jeden komunikator',
    'features.messenger.body':
      'Wiadomości z Facebook, Instagram, Telegram i WhatsApp trafiają do jednej skrzynki w portalu. Widzisz imię i awatar klienta, powiązanie z bazą, szybka rezerwacja wizyty — jednym kliknięciem.',
    'features.ai.title': 'Asystent AI i OCR paragonów',
    'features.ai.body':
      'Sfotografuj paragon lub fakturę — Finkley odczyta kwoty, datę, dostawcę, NIP i przypisze do kategorii kosztów. Asystent AI odpowiada na pytania o zysk, marżowość usług i obciążenie pracowników.',
    'features.integrations.title': 'Integracje z narzędziami, których używasz',
    'features.integrations.body':
      'Booksy, wFirma, KSeF, Fakturownia, iFirma, inFakt, 360Księgowość, Stripe, banki PSD2 (Open Banking) — konfigurujesz raz i działa.',
    'features.security.title': 'Bezpieczeństwo na poziomie banku',
    'features.security.body':
      'Wszystkie tokeny integracji są szyfrowane na serwerze AES-256-GCM. Dane są izolowane per-salon przez Row-Level Security w Postgres. Twoja firma — twoje dane.',
    'features.booking.title': 'Kalendarz i rezerwacje online',
    'features.booking.body':
      'Dwukierunkowa synchronizacja z Booksy. Plik iCal dla Google/Apple Calendar pracownika. Rezerwacja slotu w Finkley → automatyczna blokada w Booksy.',
    'footer.privacy': 'Privacy',
    'footer.terms': 'Terms',
    'footer.contact': 'Kontakt',
    'footer.rights': '© 2026 Finkley. Wszelkie prawa zastrzeżone.',
  },
}
