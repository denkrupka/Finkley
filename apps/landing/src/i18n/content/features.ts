/**
 * Контент трёх feature-страниц (AI, Интеграции, Мессенджер) по локалям
 * (B-prime: shared-шаблоны AiBody/IntegrationsBody/MessengerBody.astro
 * рендерят обе локали из этого модуля).
 *
 * RU — источник истины (verbatim из прежних features/*.astro). PL — ЧЕРНОВИК
 * перевода, ⚠️ ТРЕБУЕТ ВЫЧИТКИ НОСИТЕЛЕМ ПОЛЬСКОГО перед публикацией (owner-гейт).
 * Имена в чат-моке мессенджера (Anna Bober, AB) — демо, оставлены как есть.
 */
import type { Locale } from '../routing'

/** Пара [title, desc] для карточек/секций. */
export type Pair = [string, string]

/** h1 с возможным акцентным span'ом и опциональным <br/> перед ним. */
export type SplitHeading = {
  pre: string
  accent: string
  /** Есть ли <br/> между pre и accent. */
  br: boolean
}

export type AiCopy = {
  title: string
  description: string
  eyebrow: string
  h1: SplitHeading
  subtitle: string
  answerBlockTitle: string
  answerBlockText: string
  ocr: { title: string; text: string; items: string[] }
  assistant: { title: string; text: string; items: string[] }
  cta: { heading: string; text: string; button: string; microcopy: string }
  breadcrumbHome: string
  breadcrumbSelf: string
}

export type IntegrationRow = { name: string; cat: string; desc: string }

export type IntegrationsCopy = {
  title: string
  description: string
  eyebrow: string
  h1: SplitHeading
  subtitle: string
  answerBlockTitle: string
  answerBlockText: string
  integrations: IntegrationRow[]
  cta: { heading: string; textPre: string; emailLabel: string; textPost: string; button: string }
  breadcrumbHome: string
  breadcrumbSelf: string
}

export type ChannelCard = { name: string; text: string; glyph: string; bg: string }
export type HighlightCard = { emoji: string; title: string; text: string }

export type MessengerCopy = {
  title: string
  description: string
  eyebrow: string
  h1: SplitHeading
  subtitle: string
  ctaPrimary: string
  ctaSecondary: string
  /** Чат-мок (имена — демо, не локализуются). */
  mock: {
    name: string
    status: string
    visitButton: string
    msg1: string
    msg2: string
    msg3: string
    inputPlaceholder: string
  }
  channelsHeading: string
  channelsSubtitle: string
  channels: ChannelCard[]
  highlightsHeading: string
  highlights: HighlightCard[]
  cta: { heading: string; text: string; button: string }
  breadcrumbHome: string
  breadcrumbSelf: string
}

export type FeaturesCopy = {
  ai: AiCopy
  integrations: IntegrationsCopy
  messenger: MessengerCopy
}

const ru: FeaturesCopy = {
  ai: {
    title: 'AI для салона красоты: OCR чеков и помощник — Finkley',
    description:
      'AI в Finkley распознаёт чеки и фактуры (сумма, дата, поставщик, NIP) и отвечает на вопросы о прибыли салона. Меньше ручного ввода — больше времени на клиентов.',
    eyebrow: 'AI для салона красоты',
    h1: { pre: 'Никаких ручных вводов ', accent: '— ИИ делает за тебя', br: false },
    subtitle:
      'Сфотографируй чек, задай вопрос вслух — Finkley распознаёт, считает, отвечает. Меньше рутины — больше клиентов.',
    answerBlockTitle: 'Что делает AI Finkley.',
    answerBlockText:
      'Искусственный интеллект в Finkley решает две задачи салона красоты: распознаёт чеки и фактуры поставщиков (сумма, дата, продавец, NIP) и автоматически заносит их в расходы, а также отвечает на вопросы о прибыли, марже и загрузке мастеров обычными словами — без формул, таблиц и курсов по аналитике.',
    ocr: {
      title: 'OCR чеков и инвойсов',
      text: 'Фотография чека или PDF инвойса от поставщика → распознавание суммы, даты, NIP продавца, NIP nabywcy и автоматическая запись в правильную статью расходов. Если NIP nabywcy совпадает с твоей фирмой — расход улетает в подключённую бухгалтерию автоматом.',
      items: [
        'Поддержка кириллицы, латиницы, польского',
        'Работает с любыми форматами: бумажный чек, PDF, email-фактура',
        'Автоматическая категоризация (материалы, аренда, маркетинг…)',
        'Инвентарь — товарные позиции с чека сразу в склад',
      ],
    },
    assistant: {
      title: 'AI-помощник',
      text: 'Спрашиваешь словами — отвечает цифрами и графиками. «Сколько я заработала в прошлом месяце?», «Какая услуга самая выгодная?», «Кто из мастеров недогружен?» — без формул и таблиц.',
      items: [
        'Анализ маржинальности услуг и мастеров',
        'Insights: «Ваш доход вырос на 12% за неделю — продажи продукции +30%»',
        'Прогноз на месяц по тренду',
        'Бенчмарки против похожих салонов твоего размера',
      ],
    },
    cta: {
      heading: 'Освободи 5 часов в неделю',
      text: 'Среднее время, которое салон тратит на финансы вручную. Finkley его возвращает.',
      button: 'Начать бесплатно — 14 дней',
      microcopy: 'Без карты, отмена в один клик',
    },
    breadcrumbHome: 'Главная',
    breadcrumbSelf: 'AI и OCR чеков',
  },

  integrations: {
    title: 'Интеграции Finkley: Booksy, банк, KSeF, wFirma и ещё 11',
    description:
      '15+ интеграций для салона красоты: Booksy, банки ЕС (PSD2), KSeF, wFirma, Fakturownia, iFirma, Stripe, Facebook, Instagram, Telegram, WhatsApp, Google и Apple Calendar.',
    eyebrow: 'Интеграции',
    h1: { pre: 'Подключи свои инструменты —', accent: 'в 2 клика, без программиста', br: true },
    subtitle:
      'Booksy, wFirma, банки, мессенджеры. Один раз настроил — дальше Finkley сам тянет данные.',
    answerBlockTitle: 'С чем интегрируется Finkley.',
    answerBlockText:
      'Finkley подключается к системе записи Booksy, банкам ЕС через открытый банкинг (PSD2), польским бухгалтерским и налоговым сервисам (KSeF, wFirma, Fakturownia, iFirma, 360Księgowość), к Stripe, а также к мессенджерам Facebook, Instagram, Telegram и WhatsApp и календарям Google и Apple — всего 15+ интеграций, без ручного переноса данных.',
    integrations: [
      { name: 'Booksy', cat: 'Записи', desc: 'Двусторонняя синхронизация визитов и мастеров.' },
      {
        name: 'wFirma',
        cat: 'Бухгалтерия PL',
        desc: 'Автоматическая отправка расходов в бухгалтерию.',
      },
      {
        name: 'KSeF',
        cat: 'Налоговая PL',
        desc: 'Прямой обмен фактурами через государственную систему.',
      },
      { name: 'Fakturownia', cat: 'Бухгалтерия PL', desc: 'Импорт расходов и выставление счетов.' },
      { name: 'iFirma', cat: 'Бухгалтерия PL', desc: 'Sync расходов и контрагентов.' },
      {
        name: 'inFakt',
        cat: 'Бухгалтерия PL',
        desc: 'Полная двусторонняя интеграция (партнёрская программа).',
      },
      { name: '360Księgowość', cat: 'Бухгалтерия PL', desc: 'Автоэкспорт фактур и операций.' },
      { name: 'Stripe', cat: 'Платежи', desc: 'Online-платежи + автоматический Stripe Tax (VAT).' },
      {
        name: 'Open Banking (PSD2)',
        cat: 'Банки',
        desc: 'Импорт банковских операций через Enable Banking.',
      },
      {
        name: 'Facebook Messenger',
        cat: 'Мессенджеры',
        desc: 'OAuth-вход в 2 клика, сообщения в едином inbox.',
      },
      {
        name: 'Instagram Direct',
        cat: 'Мессенджеры',
        desc: 'Через Facebook Page или Instagram Login API.',
      },
      { name: 'Telegram', cat: 'Мессенджеры', desc: 'Бот в @BotFather → токен → готово.' },
      {
        name: 'WhatsApp Business Cloud API',
        cat: 'Мессенджеры',
        desc: 'Cloud API без сторонних BSP.',
      },
      {
        name: 'Google Calendar / iCal',
        cat: 'Календари',
        desc: 'iCal-фид для подключения календаря мастера.',
      },
      {
        name: 'Apple Calendar',
        cat: 'Календари',
        desc: 'Тот же iCal-фид — мастер видит расписание на iPhone.',
      },
    ],
    cta: {
      heading: 'Нужна интеграция, которой ещё нет?',
      textPre: 'Напиши на ',
      emailLabel: 'info@finkley.app',
      textPost: ' — мы добавляем по запросам клиентов.',
      button: 'Попробовать 14 дней бесплатно',
    },
    breadcrumbHome: 'Главная',
    breadcrumbSelf: 'Интеграции',
  },

  messenger: {
    title: 'Мессенджер для салона: FB, IG, Telegram, WhatsApp — Finkley',
    description:
      'Все сообщения клиентов из Facebook, Instagram, Telegram и WhatsApp в одной ленте Finkley. Привязка к карточке клиента, запись на визит в пару кликов, массовые рассылки.',
    eyebrow: 'Unified Messenger',
    h1: { pre: 'Один экран для всех клиентов —', accent: 'FB, IG, Telegram, WhatsApp.', br: true },
    subtitle:
      'Сообщения из всех мессенджеров приходят в Finkley. Ответ — одной кнопкой. История — навсегда. Новый клиент → одной кнопкой добавляется в базу и линкуется к переписке.',
    ctaPrimary: 'Попробовать 14 дней бесплатно',
    ctaSecondary: 'Цены →',
    mock: {
      name: 'Anna Bober',
      status: 'Instagram · в базе',
      visitButton: '+ Визит',
      msg1: 'Привет! У вас есть место на маникюр в субботу?',
      msg2: 'Привет! Да, в субботу есть в 14:00 и 17:00. Какое удобнее?',
      msg3: '17:00 идеально 🥰',
      inputPlaceholder: 'Напиши сообщение…',
    },
    channelsHeading: '4 канала, один inbox',
    channelsSubtitle: 'Клиенты пишут где удобно. Тебе — приходит в одно место.',
    channels: [
      {
        name: 'Telegram',
        text: 'Бот в @BotFather → токен в Finkley. Ответы из портала уходят клиенту в Telegram.',
        glyph: '✈',
        bg: '#229ED9',
      },
      {
        name: 'WhatsApp Business',
        text: 'Через WhatsApp Cloud API. Подключи свой бизнес-номер — клиенты пишут как обычно.',
        glyph: '☎',
        bg: '#25D366',
      },
      {
        name: 'Instagram Direct',
        text: '«Войти через Instagram» → один клик, и DM-сообщения уже в Finkley.',
        glyph: '📷',
        bg: '#E4405F',
      },
      {
        name: 'Facebook Messenger',
        text: '«Войти через Facebook» подключит и Page Messenger, и Instagram, привязанный к этой Page.',
        glyph: 'f',
        bg: '#1877F2',
      },
    ],
    highlightsHeading: 'Что делает Finkley крутым мессенджером',
    highlights: [
      {
        emoji: '🪪',
        title: 'Привязка к карточке клиента',
        text: 'В шапке чата — зелёная плашка «В базе», если клиент уже у тебя. Если нет — кнопка «+ В клиенты», создаёт карточку с предзаполненным именем и сразу привязывает переписку. В следующий раз — уже зелёная плашка.',
      },
      {
        emoji: '⚡',
        title: 'Запись на визит за 5 секунд',
        text: 'Из шапки чата кнопка «Создать визит» — модалка открывается с подставленным клиентом. Выбрала мастера и услугу — готово, визит в книге.',
      },
      {
        emoji: '📸',
        title: 'Фото и файлы — обоими способами',
        text: 'Клиент шлёт фото референса — оно отображается прямо в чате. Ты можешь отправить портфолио или прайс PDF одной кнопкой — клиент получит в свой мессенджер.',
      },
      {
        emoji: '📣',
        title: 'Массовая рассылка',
        text: 'Выбираешь любых клиентов из ленты (всех IG-овых, всех с последним визитом >30 дней) — одно сообщение уходит каждому. Reactivation новых клиентов в 2 клика.',
      },
      {
        emoji: '🔔',
        title: 'Уведомления в Telegram',
        text: 'Новое сообщение от клиента → push в твой Telegram. Не пропустишь, даже когда салон уже закрыт, а ты в магазине.',
      },
      {
        emoji: '🛡',
        title: 'Безопасность по умолчанию',
        text: 'Токены доступа Meta шифруются AES-256-GCM. Каждый салон видит только свои переписки (Row-Level Security в Postgres). Полное соответствие GDPR и Meta App Review.',
      },
    ],
    cta: {
      heading: 'Перестань копировать сообщения между приложениями',
      text: '14 дней бесплатно. Подключение FB/IG в 2 клика. Telegram-бот за 5 минут.',
      button: 'Начать бесплатно',
    },
    breadcrumbHome: 'Главная',
    breadcrumbSelf: 'Единый мессенджер',
  },
}

// ⚠️ PL — машинный черновик, ТРЕБУЕТ ВЫЧИТКИ НОСИТЕЛЕМ ПОЛЬСКОГО перед публикацией.
// Имена в чат-моке (Anna Bober, AB) — демо, оставлены как есть.
const pl: FeaturesCopy = {
  ai: {
    title: 'AI dla salonu piękności: OCR paragonów i asystent — Finkley',
    description:
      'AI w Finkley rozpoznaje paragony i faktury (kwota, data, dostawca, NIP) i odpowiada na pytania o zysk salonu. Mniej ręcznego wpisywania — więcej czasu dla klientów.',
    eyebrow: 'AI dla salonu piękności',
    h1: { pre: 'Żadnego ręcznego wpisywania ', accent: '— AI robi to za Ciebie', br: false },
    subtitle:
      'Zrób zdjęcie paragonu, zadaj pytanie na głos — Finkley rozpoznaje, liczy, odpowiada. Mniej rutyny — więcej klientów.',
    answerBlockTitle: 'Co robi AI Finkley.',
    answerBlockText:
      'Sztuczna inteligencja w Finkley rozwiązuje dwa zadania salonu piękności: rozpoznaje paragony i faktury dostawców (kwota, data, sprzedawca, NIP) i automatycznie wpisuje je w koszty, a także odpowiada na pytania o zysk, marżę i obłożenie pracowników zwykłymi słowami — bez formuł, tabel i kursów z analityki.',
    ocr: {
      title: 'OCR paragonów i faktur',
      text: 'Zdjęcie paragonu lub PDF faktury od dostawcy → rozpoznanie kwoty, daty, NIP sprzedawcy, NIP nabywcy i automatyczny wpis w odpowiednią pozycję kosztów. Jeśli NIP nabywcy zgadza się z Twoją firmą — koszt trafia do podłączonej księgowości automatycznie.',
      items: [
        'Obsługa cyrylicy, łacinki, polskiego',
        'Działa z dowolnymi formatami: papierowy paragon, PDF, faktura e-mail',
        'Automatyczna kategoryzacja (materiały, najem, marketing…)',
        'Inwentarz — pozycje towarowe z paragonu od razu do magazynu',
      ],
    },
    assistant: {
      title: 'Asystent AI',
      text: 'Pytasz słowami — odpowiada liczbami i wykresami. „Ile zarobiłam w zeszłym miesiącu?", „Która usługa jest najbardziej opłacalna?", „Który pracownik jest niedociążony?" — bez formuł i tabel.',
      items: [
        'Analiza marżowości usług i pracowników',
        'Insights: „Twój dochód wzrósł o 12% w tydzień — sprzedaż produktów +30%"',
        'Prognoza na miesiąc według trendu',
        'Benchmarki względem podobnych salonów Twojej wielkości',
      ],
    },
    cta: {
      heading: 'Odzyskaj 5 godzin tygodniowo',
      text: 'Średni czas, który salon traci na finanse ręcznie. Finkley go zwraca.',
      button: 'Zacznij za darmo — 14 dni',
      microcopy: 'Bez karty, anulowanie jednym kliknięciem',
    },
    breadcrumbHome: 'Strona główna',
    breadcrumbSelf: 'AI i OCR paragonów',
  },

  integrations: {
    title: 'Integracje Finkley: Booksy, bank, KSeF, wFirma i jeszcze 11',
    description:
      '15+ integracji dla salonu piękności: Booksy, banki UE (PSD2), KSeF, wFirma, Fakturownia, iFirma, Stripe, Facebook, Instagram, Telegram, WhatsApp, Google i Apple Calendar.',
    eyebrow: 'Integracje',
    h1: { pre: 'Podłącz swoje narzędzia —', accent: 'w 2 kliknięcia, bez programisty', br: true },
    subtitle:
      'Booksy, wFirma, banki, komunikatory. Raz skonfigurowane — dalej Finkley sam pobiera dane.',
    answerBlockTitle: 'Z czym integruje się Finkley.',
    answerBlockText:
      'Finkley łączy się z systemem rezerwacji Booksy, bankami UE przez otwartą bankowość (PSD2), polskimi usługami księgowymi i podatkowymi (KSeF, wFirma, Fakturownia, iFirma, 360Księgowość), ze Stripe, a także z komunikatorami Facebook, Instagram, Telegram i WhatsApp oraz kalendarzami Google i Apple — łącznie 15+ integracji, bez ręcznego przenoszenia danych.',
    integrations: [
      {
        name: 'Booksy',
        cat: 'Rezerwacje',
        desc: 'Dwukierunkowa synchronizacja wizyt i pracowników.',
      },
      {
        name: 'wFirma',
        cat: 'Księgowość PL',
        desc: 'Automatyczne wysyłanie kosztów do księgowości.',
      },
      {
        name: 'KSeF',
        cat: 'Skarbówka PL',
        desc: 'Bezpośrednia wymiana faktur przez system państwowy.',
      },
      { name: 'Fakturownia', cat: 'Księgowość PL', desc: 'Import kosztów i wystawianie faktur.' },
      { name: 'iFirma', cat: 'Księgowość PL', desc: 'Sync kosztów i kontrahentów.' },
      {
        name: 'inFakt',
        cat: 'Księgowość PL',
        desc: 'Pełna dwukierunkowa integracja (program partnerski).',
      },
      { name: '360Księgowość', cat: 'Księgowość PL', desc: 'Autoeksport faktur i operacji.' },
      {
        name: 'Stripe',
        cat: 'Płatności',
        desc: 'Płatności online + automatyczny Stripe Tax (VAT).',
      },
      {
        name: 'Open Banking (PSD2)',
        cat: 'Banki',
        desc: 'Import operacji bankowych przez Enable Banking.',
      },
      {
        name: 'Facebook Messenger',
        cat: 'Komunikatory',
        desc: 'Logowanie OAuth w 2 kliknięcia, wiadomości w jednym inboxie.',
      },
      {
        name: 'Instagram Direct',
        cat: 'Komunikatory',
        desc: 'Przez Facebook Page lub Instagram Login API.',
      },
      { name: 'Telegram', cat: 'Komunikatory', desc: 'Bot w @BotFather → token → gotowe.' },
      {
        name: 'WhatsApp Business Cloud API',
        cat: 'Komunikatory',
        desc: 'Cloud API bez zewnętrznych BSP.',
      },
      {
        name: 'Google Calendar / iCal',
        cat: 'Kalendarze',
        desc: 'Kanał iCal do podłączenia kalendarza pracownika.',
      },
      {
        name: 'Apple Calendar',
        cat: 'Kalendarze',
        desc: 'Ten sam kanał iCal — pracownik widzi grafik na iPhonie.',
      },
    ],
    cta: {
      heading: 'Potrzebujesz integracji, której jeszcze nie ma?',
      textPre: 'Napisz na ',
      emailLabel: 'info@finkley.app',
      textPost: ' — dodajemy je na życzenie klientów.',
      button: 'Wypróbuj 14 dni za darmo',
    },
    breadcrumbHome: 'Strona główna',
    breadcrumbSelf: 'Integracje',
  },

  messenger: {
    title: 'Komunikator dla salonu: FB, IG, Telegram, WhatsApp — Finkley',
    description:
      'Wszystkie wiadomości klientów z Facebooka, Instagrama, Telegrama i WhatsAppa w jednej osi czasu Finkley. Powiązanie z kartą klienta, zapis na wizytę w parę kliknięć, masowe wysyłki.',
    eyebrow: 'Unified Messenger',
    h1: {
      pre: 'Jeden ekran dla wszystkich klientów —',
      accent: 'FB, IG, Telegram, WhatsApp.',
      br: true,
    },
    subtitle:
      'Wiadomości ze wszystkich komunikatorów przychodzą do Finkley. Odpowiedź — jednym przyciskiem. Historia — na zawsze. Nowy klient → jednym przyciskiem dodaje się do bazy i łączy z rozmową.',
    ctaPrimary: 'Wypróbuj 14 dni za darmo',
    ctaSecondary: 'Ceny →',
    mock: {
      name: 'Anna Bober',
      status: 'Instagram · w bazie',
      visitButton: '+ Wizyta',
      msg1: 'Cześć! Macie wolny termin na manicure w sobotę?',
      msg2: 'Cześć! Tak, w sobotę jest 14:00 i 17:00. Który pasuje bardziej?',
      msg3: '17:00 idealnie 🥰',
      inputPlaceholder: 'Napisz wiadomość…',
    },
    channelsHeading: '4 kanały, jeden inbox',
    channelsSubtitle: 'Klienci piszą tam, gdzie wygodnie. Do Ciebie — trafia w jedno miejsce.',
    channels: [
      {
        name: 'Telegram',
        text: 'Bot w @BotFather → token w Finkley. Odpowiedzi z portalu trafiają do klienta na Telegramie.',
        glyph: '✈',
        bg: '#229ED9',
      },
      {
        name: 'WhatsApp Business',
        text: 'Przez WhatsApp Cloud API. Podłącz swój numer firmowy — klienci piszą jak zwykle.',
        glyph: '☎',
        bg: '#25D366',
      },
      {
        name: 'Instagram Direct',
        text: '„Zaloguj przez Instagram" → jedno kliknięcie, i wiadomości DM są już w Finkley.',
        glyph: '📷',
        bg: '#E4405F',
      },
      {
        name: 'Facebook Messenger',
        text: '„Zaloguj przez Facebook" podłączy i Page Messenger, i Instagram powiązany z tą Page.',
        glyph: 'f',
        bg: '#1877F2',
      },
    ],
    highlightsHeading: 'Co czyni Finkley świetnym komunikatorem',
    highlights: [
      {
        emoji: '🪪',
        title: 'Powiązanie z kartą klienta',
        text: 'W nagłówku czatu — zielona plakietka „W bazie", jeśli klient już u Ciebie jest. Jeśli nie — przycisk „+ Do klientów" tworzy kartę z wypełnionym imieniem i od razu wiąże rozmowę. Następnym razem — już zielona plakietka.',
      },
      {
        emoji: '⚡',
        title: 'Zapis na wizytę w 5 sekund',
        text: 'Z nagłówka czatu przycisk „Utwórz wizytę" — okno otwiera się z podstawionym klientem. Wybierasz pracownika i usługę — gotowe, wizyta w grafiku.',
      },
      {
        emoji: '📸',
        title: 'Zdjęcia i pliki — w obie strony',
        text: 'Klient przysyła zdjęcie referencji — wyświetla się od razu w czacie. Możesz wysłać portfolio lub cennik PDF jednym przyciskiem — klient dostanie je w swoim komunikatorze.',
      },
      {
        emoji: '📣',
        title: 'Masowa wysyłka',
        text: 'Wybierasz dowolnych klientów z osi czasu (wszystkich z IG, wszystkich z ostatnią wizytą >30 dni) — jedna wiadomość trafia do każdego. Reaktywacja klientów w 2 kliknięcia.',
      },
      {
        emoji: '🔔',
        title: 'Powiadomienia w Telegramie',
        text: 'Nowa wiadomość od klienta → push na Twój Telegram. Nie przegapisz, nawet gdy salon jest już zamknięty, a Ty w sklepie.',
      },
      {
        emoji: '🛡',
        title: 'Bezpieczeństwo domyślnie',
        text: 'Tokeny dostępu Meta szyfrowane AES-256-GCM. Każdy salon widzi tylko swoje rozmowy (Row-Level Security w Postgresie). Pełna zgodność z RODO i Meta App Review.',
      },
    ],
    cta: {
      heading: 'Przestań kopiować wiadomości między aplikacjami',
      text: '14 dni za darmo. Podłączenie FB/IG w 2 kliknięcia. Bot Telegram w 5 minut.',
      button: 'Zacznij za darmo',
    },
    breadcrumbHome: 'Strona główna',
    breadcrumbSelf: 'Jeden komunikator',
  },
}

export const featuresContent: Record<Locale, FeaturesCopy> = { ru, pl }

/**
 * Строит BreadcrumbList JSON-LD для feature-страницы (как в прежних
 * features/*.astro). selfUrl/homeUrl — абсолютные URL текущей локали.
 */
export function buildFeatureBreadcrumb(
  homeName: string,
  selfName: string,
  selfUrl: string,
  homeUrl: string,
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: homeName, item: homeUrl },
      { '@type': 'ListItem', position: 2, name: selfName, item: selfUrl },
    ],
  }
}
