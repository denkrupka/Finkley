/**
 * Контент двух SEO-страниц (compare/finkley-vs-booksy и
 * use-cases/uchet-dlya-salona-krasoty) по локалям (B-prime: shared-шаблоны
 * CompareBody/UseCasesBody.astro рендерят обе локали из этого модуля).
 *
 * RU — источник истины (verbatim из прежних compare/use-cases *.astro).
 * PL — ЧЕРНОВИК перевода, ⚠️ ТРЕБУЕТ ВЫЧИТКИ НОСИТЕЛЕМ ПОЛЬСКОГО перед
 * публикацией (owner-гейт). Цены (€19–99) и бренды (Booksy, KSeF) — инвариантны.
 */
import type { Locale } from '../routing'
import { localizedPath } from '../routing'

export type Faq = { q: string; a: string }

/** Строка таблицы сравнения Finkley | Booksy. */
export type CompareRow = { criterion: string; finkley: string; booksy: string }

export type CompareCopy = {
  title: string
  description: string
  eyebrow: string
  h1Pre: string
  h1Accent: string
  answerTitle: string
  answerText: string
  booksyHeading: string
  booksyLead: string
  booksyIntro: string
  booksyList: string[]
  finkleyHeading: string
  finkleyLead: string
  finkleyIntro: string
  finkleyList: string[]
  tableHeading: string
  tableLead: string
  tableIntro: string
  tableColWhat: string
  tableColFinkley: string
  tableColBooksy: string
  compare: CompareRow[]
  tableNote: string
  insteadHeading: string
  insteadLead: string
  insteadIntro: string
  insteadText: string
  connectHeading: string
  connectLead: string
  connectIntro: string
  steps: string[]
  connectMorePre: string
  connectMoreLink: string
  connectMorePost: string
  faqHeading: string
  faq: Faq[]
  relatedPre: string
  relatedUseCases: string
  relatedSep1: string
  relatedProfit: string
  relatedSep2: string
  relatedPricing: string
  relatedPost: string
  ctaHeading: string
  ctaText: string
  ctaButton: string
  ctaMicrocopy: string
  breadcrumbHome: string
  breadcrumbCompare: string
  breadcrumbSelf: string
  itemListFinkleyDesc: string
  itemListBooksyDesc: string
}

/** Карточка «учёт по типу салона». href=null → без ссылки (заглушка). */
export type ByTypeCard = {
  emoji: string
  title: string
  text: string
  href: string | null
  linkLabel: string | null
}

export type UseCasesCopy = {
  title: string
  description: string
  eyebrow: string
  h1Pre: string
  h1Accent: string
  answerTitle: string
  answerText: string
  whyHeading: string
  whyLead: string
  whyIntro: string
  whyList: string[]
  whyMorePre: string
  whyMoreLink: string
  whyMorePost: string
  countHeading: string
  countLead: string
  countIntro: string
  whatToCount: [string, string][]
  byTypeHeading: string
  byTypeLead: string
  byTypeIntro: string
  byType: ByTypeCard[]
  profitHeading: string
  profitLead: string
  profitIntro: string
  profitMorePre: string
  profitMoreLink: string
  profitMorePost: string
  helpsHeading: string
  helpsLead: string
  helpsIntro: string
  helpsMorePre: string
  helpsCompareLink: string
  helpsMoreMid: string
  helpsAiLink: string
  helpsMorePost: string
  faqHeading: string
  faq: Faq[]
  ctaHeading: string
  ctaText: string
  ctaButton: string
  ctaMicrocopy: string
  breadcrumbHome: string
  breadcrumbUseCases: string
  breadcrumbSelf: string
}

export type SeoPagesCopy = {
  compare: CompareCopy
  useCases: UseCasesCopy
}

const ru: SeoPagesCopy = {
  compare: {
    title: 'Finkley и Booksy: запись клиентов vs учёт денег',
    description:
      'Booksy ведёт запись клиентов, Finkley считает деньги салона: прибыль, маржу, зарплаты, расходы. Чем отличаются и как работают вместе. Демо 14 дней.',
    eyebrow: 'Сравнение',
    h1Pre: 'Finkley и Booksy: ',
    h1Accent: 'в чём разница и зачем вместе',
    answerTitle: 'Коротко.',
    answerText:
      ' Booksy — система онлайн-записи клиентов и календаря. Finkley — управленческий учёт денег салона: визиты, расходы, зарплаты мастеров и чистая прибыль. Это не конкуренты: Booksy ведёт расписание, Finkley подключается к нему и считает, сколько вы реально заработали. Их используют вместе.',
    booksyHeading: 'Что делает Booksy',
    booksyLead: 'Booksy — это запись клиентов.',
    booksyIntro:
      ' Сервис закрывает онлайн-бронирование, календарь мастеров, напоминания клиентам, онлайн-оплату и маркетплейс, где клиенты находят салон. Это сильный инструмент для расписания и потока клиентов. Но Booksy не показывает чистую прибыль салона и не собирает все расходы — он про записи, а не про деньги.',
    booksyList: [
      '✓ Онлайн-запись и календарь мастеров',
      '✓ Напоминания клиентам, отмены и переносы',
      '✓ Онлайн-оплата и предоплата за визит',
      '✓ Маркетплейс — клиенты находят салон в приложении Booksy',
      '✗ Не показывает чистую прибыль после всех расходов',
      '✗ Не считает зарплаты мастеров и расходы по категориям',
    ],
    finkleyHeading: 'Что делает Finkley',
    finkleyLead: 'Finkley — это учёт денег.',
    finkleyIntro:
      ' Сервис берёт визиты и оплаты (из Booksy или вручную), добавляет к ним расходы — материалы, аренду, налоги, комиссии — считает зарплаты мастеров и показывает чистую прибыль, маржу по услугам и отчёт о прибыли (P&L). Сверху — AI-помощник, который объясняет цифры обычными словами, без формул и курсов по аналитике.',
    finkleyList: [
      '✓ Чистая прибыль за день, неделю и месяц',
      '✓ Расходы по категориям: материалы, аренда, ZUS, реклама',
      '✓ Зарплаты мастеров: % от выручки, фикс или аренда кресла',
      '✓ Маржа по каждой услуге и отчёт о прибыли (P&L)',
      '✓ Подключение к банку и фактуры / KSeF прямо в расходы',
      '✓ AI-помощник по прибыли на русском',
    ],
    tableHeading: 'Сравнение: запись против учёта денег',
    tableLead: 'Главное различие в одной таблице.',
    tableIntro:
      ' Booksy закрывает запись и календарь клиентов, Finkley — деньги: прибыль, расходы, зарплаты и маржу. Пересечения почти нет, поэтому сервисы не мешают друг другу, а дополняют. Ниже — построчное сравнение по ключевым функциям салона красоты.',
    tableColWhat: 'Что умеет',
    tableColFinkley: 'Finkley',
    tableColBooksy: 'Booksy',
    compare: [
      { criterion: 'Онлайн-запись клиентов', finkley: '—', booksy: '✓' },
      { criterion: 'Календарь и напоминания клиентам', finkley: '—', booksy: '✓' },
      { criterion: 'Чистая прибыль за период', finkley: '✓', booksy: '—' },
      { criterion: 'Расходы по категориям', finkley: '✓', booksy: '—' },
      { criterion: 'Зарплата мастеров (% / фикс / аренда кресла)', finkley: '✓', booksy: '—' },
      { criterion: 'Маржа по услугам', finkley: '✓', booksy: '—' },
      { criterion: 'Подключение к банку', finkley: '✓', booksy: '—' },
      { criterion: 'Фактуры / KSeF в расходы', finkley: '✓', booksy: '—' },
      { criterion: 'AI-помощник по прибыли', finkley: '✓', booksy: '—' },
      {
        criterion: 'Цена',
        finkley: 'Demo 14 дней → Free, платные €19–99',
        booksy: 'Отдельный тариф записи',
      },
    ],
    tableNote: '«—» означает, что функция не является задачей сервиса, а не недоработку.',
    insteadHeading: 'Можно ли использовать Finkley вместо Booksy?',
    insteadLead: 'Честно: нет, Finkley не заменяет запись.',
    insteadIntro:
      ' В Finkley нет онлайн-бронирования, маркетплейса и автоматических напоминаний клиентам — этим занимается Booksy. Finkley закрывает деньги: прибыль, расходы и зарплаты. Поэтому два сервиса дополняют друг друга, а синхронизация между ними настраивается в один клик при подключении.',
    insteadText:
      'Если запись клиентов уже идёт в Booksy — оставьте её там. Finkley подключится сверху и возьмёт оттуда визиты и оплаты, чтобы посчитать реальную прибыль. А если Booksy нет — визиты можно вносить вручную, и учёт денег всё равно работает.',
    connectHeading: 'Как подключить Booksy к Finkley',
    connectLead: 'Подключение занимает пару минут и не требует переноса данных.',
    connectIntro:
      ' Один раз входишь в Booksy через онбординг Finkley — и визиты, оплаты, услуги и клиенты подтягиваются сами. Дальше всё работает в фоне.',
    steps: [
      'В онбординге выбери «Подключить Booksy» и войди в свой аккаунт Booksy — один раз.',
      'Finkley сам подтянет визиты, услуги, клиентов и оплаты. Переносить данные руками не нужно.',
      'Дальше синхронизация идёт в фоне: новые визиты из Booksy появляются в Finkley автоматически.',
      'Добавляешь расходы и зарплаты — и видишь чистую прибыль по данным из Booksy.',
    ],
    connectMorePre: 'Подробнее про интеграции —',
    connectMoreLink: 'на странице интеграций',
    connectMorePost: '.',
    faqHeading: 'Частые вопросы',
    faq: [
      {
        q: 'Finkley заменяет Booksy?',
        a: 'Нет. Booksy ведёт онлайн-запись и календарь клиентов, Finkley считает деньги салона — прибыль, расходы, зарплаты, маржу. Это разные задачи. Большинство салонов используют их вместе: запись в Booksy, учёт денег в Finkley.',
      },
      {
        q: 'Нужно ли переносить данные из Booksy?',
        a: 'Нет. Подключаешь Booksy один раз в онбординге, и Finkley сам тянет визиты, оплаты, услуги и клиентов. Ничего вводить и переносить вручную не нужно — синхронизация идёт автоматически.',
      },
      {
        q: 'Сколько стоит Finkley рядом с Booksy?',
        a: 'Finkley — отдельная подписка от вашего тарифа Booksy. Есть демо на 14 дней без карты, бесплатный тариф навсегда (учёт доходов) и платные тарифы €19–99/мес. НДС не взимается. Тариф Booksy при этом не меняется.',
      },
      {
        q: 'Работает ли Finkley без Booksy?',
        a: 'Да. Booksy не обязателен. Если записи ведутся в другом сервисе или в блокноте, визит можно внести в Finkley вручную примерно за 10 секунд, а расходы и зарплаты считаются так же. Booksy просто избавляет от ручного ввода визитов.',
      },
    ],
    relatedPre: 'Дальше по теме:',
    relatedUseCases: 'учёт для салона красоты',
    relatedSep1: ',',
    relatedProfit: 'как считать прибыль салона',
    relatedSep2: ' и',
    relatedPricing: 'тарифы Finkley',
    relatedPost: '.',
    ctaHeading: 'Подключи Booksy и увидь свою прибыль',
    ctaText: 'Finkley берёт визиты из Booksy и считает деньги за тебя.',
    ctaButton: 'Начать бесплатно — 14 дней',
    ctaMicrocopy: 'Без карты',
    breadcrumbHome: 'Главная',
    breadcrumbCompare: 'Сравнение',
    breadcrumbSelf: 'Finkley и Booksy',
    itemListFinkleyDesc:
      'Управленческий учёт денег салона красоты: визиты, расходы, зарплаты мастеров, маржа и чистая прибыль.',
    itemListBooksyDesc: 'Система онлайн-записи клиентов и календарь для салонов красоты.',
  },

  useCases: {
    title: 'Учёт для салона красоты: деньги, прибыль, зарплаты',
    description:
      'Учёт для салона красоты простыми словами: визиты, расходы, зарплаты мастеров, маржа и чистая прибыль в одном месте. Без бухгалтерских знаний. Демо 14 дней без карты.',
    eyebrow: 'Сценарии',
    h1Pre: 'Учёт для салона красоты ',
    h1Accent: '— что это и как вести',
    answerTitle: 'Что такое учёт для салона красоты.',
    answerText:
      ' Это система, которая считает не только выручку, но и все расходы — материалы, зарплату мастеров, аренду, налоги, комиссии — и показывает чистую прибыль за день, неделю и месяц. В отличие от кассы или Excel, она связывает визиты, деньги и зарплаты в один отчёт.',
    whyHeading: 'Почему кассы и Excel недостаточно',
    whyLead: 'Касса считает выручку, а не прибыль.',
    whyIntro:
      ' «12 клиентов по 200 — значит 2400 в кассе» — это не заработок: из этой суммы ещё уйдут материалы, зарплата мастера, аренда и налоги. Excel умеет складывать, но не считает прибыль сам, не виден из дома и не связывает визиты с расходами. Для учёта салона этого мало.',
    whyList: [
      '✗ Касса показывает оборот, но не остаток после всех расходов',
      '✗ Excel редактирует один человек — мастер пробил визит, владелец видит вечером',
      '✗ Нет связи с календарём: визит отменили, а в файле он остался',
      '✗ Отчёт «выручка по мастерам за месяц» приходится собирать руками',
      '✗ Нет уведомлений — про просадку узнаёшь, когда уже поздно реагировать',
    ],
    whyMorePre: 'Подробнее, почему салону нужен управленческий учёт —',
    whyMoreLink: 'в этой статье',
    whyMorePost: '.',
    countHeading: 'Что должен считать салон красоты',
    countLead: 'Четыре цифры, на которых держится прибыль.',
    countIntro:
      ' Чтобы понимать деньги салона, достаточно регулярно считать маржу по услугам, зарплату мастеров от выручки, постоянные расходы и поправку на сезонность. Всё остальное вытекает из них.',
    whatToCount: [
      [
        'Маржу по услугам',
        'Сколько остаётся от услуги после расхода материалов и выплаты мастеру. Иногда «дорогая» услуга оказывается менее выгодной, чем простая.',
      ],
      [
        'Зарплату от выручки',
        'Процент мастеру, фикс или аренда кресла. При высоком проценте часть услуг может уходить в ноль или минус.',
      ],
      [
        'Постоянные расходы',
        'Аренда, ZUS, электроэнергия, подписки — это «налог» на каждый рабочий день, который надо отбить до первой прибыли.',
      ],
      [
        'Сезонность',
        'Январь и август обычно проседают. Учёт показывает спад заранее, а не постфактум.',
      ],
    ],
    byTypeHeading: 'Учёт по типу салона',
    byTypeLead: 'Принцип один, акценты разные.',
    byTypeIntro:
      ' У маникюрного салона главное — себестоимость материалов на услугу, у барбершопа — схема оплаты мастеров и загрузка кресел, у косметологии — дорогие препараты и курсы процедур. Finkley настраивается под любой из этих случаев.',
    byType: [
      {
        emoji: '💅',
        title: 'Маникюрный салон',
        text: 'Расход геля, базы и топа на услугу, себестоимость и маржа маникюра, остатки материалов.',
        href: '/media/uchet-dlya-manikyurnogo-salona/',
        linkLabel: 'Учёт для маникюрного салона →',
      },
      {
        emoji: '💈',
        title: 'Барбершоп',
        text: 'Процент мастеру против аренды кресла, выручка по барберам, загрузка кресел, расчёт ЗП.',
        href: '/media/uchet-dlya-barbershopa/',
        linkLabel: 'Учёт для барбершопа →',
      },
      {
        emoji: '✨',
        title: 'Косметология',
        text: 'Дорогие препараты и аппаратные процедуры, курсы из нескольких сеансов, абонементы. Подход тот же: считаем себестоимость процедуры, маржу и чистую прибыль. Отдельная статья — скоро.',
        href: null,
        linkLabel: null,
      },
    ],
    profitHeading: 'Как считать прибыль салона',
    profitLead: 'Прибыль = выручка минус все расходы.',
    profitIntro:
      ' От суммы оплат за период вычитаешь материалы, зарплату мастеров, аренду, налоги (ZUS/VAT) и комиссии — то, что осталось, и есть чистая прибыль. Точка безубыточности показывает, какую выручку нужно сделать, чтобы выйти в ноль.',
    profitMorePre: 'Разбор формулы с примером в цифрах —',
    profitMoreLink: 'в статье «Как считать прибыль салона»',
    profitMorePost: '.',
    helpsHeading: 'Чем Finkley помогает',
    helpsLead: 'Finkley ведёт учёт салона за тебя.',
    helpsIntro:
      ' Визиты приходят из Booksy или вносятся вручную, расходы и фактуры подтягиваются из банка и бухгалтерии, зарплаты считаются кнопкой «Закрыть период», а чистая прибыль и маржа всегда на главном экране. AI-помощник объясняет цифры словами.',
    helpsMorePre: 'Чем Finkley отличается от Booksy —',
    helpsCompareLink: 'в сравнении',
    helpsMoreMid: '. Как работает AI-помощник —',
    helpsAiLink: 'на странице AI',
    helpsMorePost: '.',
    faqHeading: 'Частые вопросы',
    faq: [
      {
        q: 'Нужен ли салону отдельный учёт, если есть Booksy?',
        a: 'Да. Booksy показывает записи и клиентов, но не считает чистую прибыль после материалов, аренды, налогов и зарплат. Finkley берёт визиты из Booksy и добавляет к ним расходы и зарплаты, чтобы вы видели реальные деньги, а не только количество визитов.',
      },
      {
        q: 'Подойдёт ли Excel для учёта салона?',
        a: 'Excel работает, пока салон маленький и всё сходится в голове. Дальше он не считает прибыль автоматически, его сложно открыть из дома, легко потерять и трудно строить отчёты «выручка по мастерам за месяц». Программа учёта делает это сама и в реальном времени.',
      },
      {
        q: 'Сколько стоит программа учёта для салона?',
        a: 'У Finkley есть демо на 14 дней без карты, бесплатный тариф навсегда (учёт доходов) и платные тарифы €19–99/мес, которые открывают расходы, отчёты, зарплаты, AI-помощника и мульти-салон. НДС не взимается.',
      },
      {
        q: 'Нужны ли бухгалтерские знания?',
        a: 'Нет. Учёт в Finkley устроен обычными словами: прибыль, расходы, зарплаты, маржа — с понятными подписями и подсказками. Бухгалтер всё ещё нужен для отчётов в налоговую, но чтобы видеть деньги салона каждый день, знаний бухгалтерии не требуется.',
      },
    ],
    ctaHeading: 'Начни вести учёт салона сегодня',
    ctaText: 'Прибыль, расходы и зарплаты в одном месте. Без бухгалтерских знаний.',
    ctaButton: 'Начать бесплатно — 14 дней',
    ctaMicrocopy: 'Без карты',
    breadcrumbHome: 'Главная',
    breadcrumbUseCases: 'Сценарии',
    breadcrumbSelf: 'Учёт для салона красоты',
  },
}

// ⚠️ PL — машинный черновик, ТРЕБУЕТ ВЫЧИТКИ НОСИТЕЛЕМ ПОЛЬСКОГО перед публикацией.
const pl: SeoPagesCopy = {
  compare: {
    title: 'Finkley i Booksy: rezerwacje klientek vs kontrola pieniędzy',
    description:
      'Booksy prowadzi rezerwacje klientek, Finkley liczy pieniądze salonu: zysk, marżę, wynagrodzenia, koszty. Czym się różnią i jak działają razem. Demo 14 dni.',
    eyebrow: 'Porównanie',
    h1Pre: 'Finkley i Booksy: ',
    h1Accent: 'czym się różnią i po co razem',
    answerTitle: 'W skrócie.',
    answerText:
      ' Booksy to system rezerwacji online i kalendarza klientek. Finkley to zarządcza kontrola pieniędzy salonu: wizyty, koszty, wynagrodzenia pracowników i zysk netto. To nie są konkurenci: Booksy prowadzi grafik, a Finkley podłącza się do niego i liczy, ile naprawdę zarobiłaś. Korzysta się z nich razem.',
    booksyHeading: 'Co robi Booksy',
    booksyLead: 'Booksy to rezerwacje klientek.',
    booksyIntro:
      ' Serwis ogarnia rezerwacje online, kalendarz pracowników, przypomnienia dla klientek, płatności online i marketplace, w którym klientki znajdują salon. To mocne narzędzie do grafiku i pozyskiwania klientek. Ale Booksy nie pokazuje zysku netto salonu i nie zbiera wszystkich kosztów — chodzi w nim o rezerwacje, a nie o pieniądze.',
    booksyList: [
      '✓ Rezerwacje online i kalendarz pracowników',
      '✓ Przypomnienia dla klientek, odwołania i przełożenia',
      '✓ Płatności online i przedpłata za wizytę',
      '✓ Marketplace — klientki znajdują salon w aplikacji Booksy',
      '✗ Nie pokazuje zysku netto po wszystkich kosztach',
      '✗ Nie liczy wynagrodzeń pracowników ani kosztów według kategorii',
    ],
    finkleyHeading: 'Co robi Finkley',
    finkleyLead: 'Finkley to kontrola pieniędzy.',
    finkleyIntro:
      ' Serwis bierze wizyty i płatności (z Booksy albo wpisane ręcznie), dolicza do nich koszty — materiały, czynsz, podatki, prowizje — liczy wynagrodzenia pracowników i pokazuje zysk netto, marżę na usługach oraz rachunek zysków i strat (P&L). Na dokładkę asystent AI, który tłumaczy liczby zwykłymi słowami, bez wzorów i kursów z analityki.',
    finkleyList: [
      '✓ Zysk netto za dzień, tydzień i miesiąc',
      '✓ Koszty według kategorii: materiały, czynsz, ZUS, reklama',
      '✓ Wynagrodzenia pracowników: % od utargu, stała kwota lub wynajem fotela',
      '✓ Marża na każdej usłudze i rachunek zysków i strat (P&L)',
      '✓ Podłączenie do banku oraz faktury / KSeF prosto do kosztów',
      '✓ Asystent AI od zysku po polsku',
    ],
    tableHeading: 'Porównanie: rezerwacje kontra kontrola pieniędzy',
    tableLead: 'Najważniejsza różnica w jednej tabeli.',
    tableIntro:
      ' Booksy ogarnia rezerwacje i kalendarz klientek, Finkley — pieniądze: zysk, koszty, wynagrodzenia i marżę. Części wspólnej prawie nie ma, dlatego serwisy sobie nie przeszkadzają, tylko się uzupełniają. Poniżej porównanie po kolei według kluczowych funkcji salonu piękności.',
    tableColWhat: 'Co potrafi',
    tableColFinkley: 'Finkley',
    tableColBooksy: 'Booksy',
    compare: [
      { criterion: 'Rezerwacje online dla klientek', finkley: '—', booksy: '✓' },
      { criterion: 'Kalendarz i przypomnienia dla klientek', finkley: '—', booksy: '✓' },
      { criterion: 'Zysk netto za okres', finkley: '✓', booksy: '—' },
      { criterion: 'Koszty według kategorii', finkley: '✓', booksy: '—' },
      {
        criterion: 'Wynagrodzenie pracowników (% / stała kwota / wynajem fotela)',
        finkley: '✓',
        booksy: '—',
      },
      { criterion: 'Marża na usługach', finkley: '✓', booksy: '—' },
      { criterion: 'Podłączenie do banku', finkley: '✓', booksy: '—' },
      { criterion: 'Faktury / KSeF do kosztów', finkley: '✓', booksy: '—' },
      { criterion: 'Asystent AI od zysku', finkley: '✓', booksy: '—' },
      {
        criterion: 'Cena',
        finkley: 'Demo 14 dni → Free, plany płatne €19–99',
        booksy: 'Osobny plan za rezerwacje',
      },
    ],
    tableNote: '„—” oznacza, że dana funkcja nie jest zadaniem serwisu, a nie jego brak.',
    insteadHeading: 'Czy można używać Finkley zamiast Booksy?',
    insteadLead: 'Szczerze: nie, Finkley nie zastąpi rezerwacji.',
    insteadIntro:
      ' W Finkley nie ma rezerwacji online, marketplace’u ani automatycznych przypomnień dla klientek — tym zajmuje się Booksy. Finkley ogarnia pieniądze: zysk, koszty i wynagrodzenia. Dlatego oba serwisy się uzupełniają, a synchronizację między nimi ustawiasz jednym kliknięciem przy podłączeniu.',
    insteadText:
      'Jeśli rezerwacje klientek prowadzisz już w Booksy — zostaw je tam. Finkley podłączy się na wierzchu i pobierze stamtąd wizyty oraz płatności, żeby policzyć realny zysk. A jeśli nie masz Booksy — wizyty możesz wpisywać ręcznie, a kontrola pieniędzy i tak działa.',
    connectHeading: 'Jak podłączyć Booksy do Finkley',
    connectLead: 'Podłączenie zajmuje parę minut i nie wymaga przenoszenia danych.',
    connectIntro:
      ' Raz logujesz się do Booksy w onboardingu Finkley — i wizyty, płatności, usługi oraz klientki pobierają się same. Dalej wszystko działa w tle.',
    steps: [
      'W onboardingu wybierz „Podłącz Booksy” i zaloguj się na swoje konto Booksy — raz.',
      'Finkley sam pobierze wizyty, usługi, klientki i płatności. Nie musisz przepisywać danych ręcznie.',
      'Dalej synchronizacja idzie w tle: nowe wizyty z Booksy pojawiają się w Finkley automatycznie.',
      'Dodajesz koszty i wynagrodzenia — i widzisz zysk netto na podstawie danych z Booksy.',
    ],
    connectMorePre: 'Więcej o integracjach —',
    connectMoreLink: 'na stronie integracji',
    connectMorePost: '.',
    faqHeading: 'Najczęstsze pytania',
    faq: [
      {
        q: 'Czy Finkley zastępuje Booksy?',
        a: 'Nie. Booksy prowadzi rezerwacje online i kalendarz klientek, a Finkley liczy pieniądze salonu — zysk, koszty, wynagrodzenia, marżę. To różne zadania. Większość salonów korzysta z nich razem: rezerwacje w Booksy, kontrola pieniędzy w Finkley.',
      },
      {
        q: 'Czy trzeba przenosić dane z Booksy?',
        a: 'Nie. Podłączasz Booksy raz w onboardingu, a Finkley sam pobiera wizyty, płatności, usługi i klientki. Niczego nie musisz wpisywać ani przenosić ręcznie — synchronizacja idzie automatycznie.',
      },
      {
        q: 'Ile kosztuje Finkley obok Booksy?',
        a: 'Finkley to osobna subskrypcja niezależna od Twojego planu Booksy. Jest demo na 14 dni bez karty, darmowy plan na zawsze (rachunek przychodów) i plany płatne €19–99/mies. VAT nie jest naliczany. Plan Booksy przy tym się nie zmienia.',
      },
      {
        q: 'Czy Finkley działa bez Booksy?',
        a: 'Tak. Booksy nie jest wymagany. Jeśli rezerwacje prowadzisz w innym serwisie albo w zeszycie, wizytę możesz wpisać do Finkley ręcznie w jakieś 10 sekund, a koszty i wynagrodzenia liczą się tak samo. Booksy po prostu zdejmuje z Ciebie ręczne wpisywanie wizyt.',
      },
    ],
    relatedPre: 'Dalej na ten temat:',
    relatedUseCases: 'księgowość dla salonu piękności',
    relatedSep1: ',',
    relatedProfit: 'jak liczyć zysk salonu',
    relatedSep2: ' i',
    relatedPricing: 'cennik Finkley',
    relatedPost: '.',
    ctaHeading: 'Podłącz Booksy i zobacz swój zysk',
    ctaText: 'Finkley bierze wizyty z Booksy i liczy pieniądze za Ciebie.',
    ctaButton: 'Zacznij za darmo — 14 dni',
    ctaMicrocopy: 'Bez karty',
    breadcrumbHome: 'Strona główna',
    breadcrumbCompare: 'Porównanie',
    breadcrumbSelf: 'Finkley i Booksy',
    itemListFinkleyDesc:
      'Zarządcza kontrola pieniędzy salonu piękności: wizyty, koszty, wynagrodzenia pracowników, marża i zysk netto.',
    itemListBooksyDesc: 'System rezerwacji online dla klientek i kalendarz dla salonów piękności.',
  },

  useCases: {
    title: 'Księgowość dla salonu piękności: pieniądze, zysk, wynagrodzenia',
    description:
      'Księgowość dla salonu piękności prostymi słowami: wizyty, koszty, wynagrodzenia pracowników, marża i zysk netto w jednym miejscu. Bez wiedzy księgowej. Demo 14 dni bez karty.',
    eyebrow: 'Scenariusze',
    h1Pre: 'Księgowość dla salonu piękności ',
    h1Accent: '— co to jest i jak ją prowadzić',
    answerTitle: 'Czym jest księgowość dla salonu piękności.',
    answerText:
      ' To system, który liczy nie tylko utarg, ale i wszystkie koszty — materiały, wynagrodzenia pracowników, czynsz, podatki, prowizje — i pokazuje zysk netto za dzień, tydzień i miesiąc. W odróżnieniu od kasy czy Excela łączy wizyty, pieniądze i wynagrodzenia w jeden raport.',
    whyHeading: 'Dlaczego kasa i Excel to za mało',
    whyLead: 'Kasa liczy utarg, a nie zysk.',
    whyIntro:
      ' „12 klientek po 200 — czyli 2400 w kasie” to nie zarobek: z tej kwoty pójdą jeszcze materiały, wynagrodzenie pracownika, czynsz i podatki. Excel umie dodawać, ale sam nie liczy zysku, nie widać go z domu i nie łączy wizyt z kosztami. Do księgowości salonu to za mało.',
    whyList: [
      '✗ Kasa pokazuje obrót, ale nie to, co zostaje po wszystkich kosztach',
      '✗ Excel edytuje jedna osoba — pracownica wbiła wizytę, właścicielka widzi to wieczorem',
      '✗ Brak powiązania z kalendarzem: wizytę odwołano, a w pliku dalej jest',
      '✗ Raport „utarg na pracownika za miesiąc” trzeba składać ręcznie',
      '✗ Brak powiadomień — o spadku dowiadujesz się, gdy jest już za późno reagować',
    ],
    whyMorePre: 'Więcej o tym, po co salonowi kontrola zarządcza —',
    whyMoreLink: 'w tym artykule',
    whyMorePost: '.',
    countHeading: 'Co powinien liczyć salon piękności',
    countLead: 'Cztery liczby, na których stoi zysk.',
    countIntro:
      ' Żeby rozumieć pieniądze salonu, wystarczy regularnie liczyć marżę na usługach, wynagrodzenie pracowników od utargu, koszty stałe i poprawkę na sezonowość. Cała reszta wynika z tych liczb.',
    whatToCount: [
      [
        'Marżę na usługach',
        'Ile zostaje z usługi po koszcie materiałów i wypłacie dla pracownika. Czasem „droga” usługa okazuje się mniej opłacalna niż prosta.',
      ],
      [
        'Wynagrodzenie od utargu',
        'Procent dla pracownika, stała kwota albo wynajem fotela. Przy wysokim procencie część usług może schodzić do zera lub na minus.',
      ],
      [
        'Koszty stałe',
        'Czynsz, ZUS, prąd, subskrypcje — to „podatek” od każdego dnia pracy, który trzeba odrobić, zanim pojawi się pierwszy zysk.',
      ],
      [
        'Sezonowość',
        'Styczeń i sierpień zwykle siadają. Księgowość pokazuje spadek z wyprzedzeniem, a nie po fakcie.',
      ],
    ],
    byTypeHeading: 'Księgowość według typu salonu',
    byTypeLead: 'Zasada jedna, akcenty różne.',
    byTypeIntro:
      ' W salonie manicure najważniejszy jest koszt materiałów na usługę, w barbershopie — schemat wynagrodzeń pracowników i obłożenie foteli, w kosmetologii — drogie preparaty i serie zabiegów. Finkley dostosujesz do każdego z tych przypadków.',
    byType: [
      {
        emoji: '💅',
        title: 'Salon manicure',
        text: 'Zużycie żelu, bazy i topu na usługę, koszt własny i marża manicure’u, stany materiałów.',
        href: '/media/uchet-dlya-manikyurnogo-salona/',
        linkLabel: 'Księgowość dla salonu manicure →',
      },
      {
        emoji: '💈',
        title: 'Barbershop',
        text: 'Procent dla pracownika kontra wynajem fotela, utarg na barbera, obłożenie foteli, naliczanie wypłat.',
        href: '/media/uchet-dlya-barbershopa/',
        linkLabel: 'Księgowość dla barbershopu →',
      },
      {
        emoji: '✨',
        title: 'Kosmetologia',
        text: 'Drogie preparaty i zabiegi aparaturowe, serie kilku sesji, karnety. Podejście jest takie samo: liczymy koszt własny zabiegu, marżę i zysk netto. Osobny artykuł — wkrótce.',
        href: null,
        linkLabel: null,
      },
    ],
    profitHeading: 'Jak liczyć zysk salonu',
    profitLead: 'Zysk = utarg minus wszystkie koszty.',
    profitIntro:
      ' Od sumy płatności za okres odejmujesz materiały, wynagrodzenia pracowników, czynsz, podatki (ZUS/VAT) i prowizje — to, co zostaje, to właśnie zysk netto. Próg rentowności pokazuje, jaki utarg trzeba zrobić, żeby wyjść na zero.',
    profitMorePre: 'Rozpisanie wzoru na konkretnych liczbach —',
    profitMoreLink: 'w artykule „Jak liczyć zysk salonu”',
    profitMorePost: '.',
    helpsHeading: 'Jak pomaga Finkley',
    helpsLead: 'Finkley prowadzi księgowość salonu za Ciebie.',
    helpsIntro:
      ' Wizyty przychodzą z Booksy albo wpisujesz je ręcznie, koszty i faktury pobierają się z banku i księgowości, wynagrodzenia liczą się przyciskiem „Zamknij okres”, a zysk netto i marża są zawsze na głównym ekranie. Asystent AI tłumaczy liczby słowami.',
    helpsMorePre: 'Czym Finkley różni się od Booksy —',
    helpsCompareLink: 'w porównaniu',
    helpsMoreMid: '. Jak działa asystent AI —',
    helpsAiLink: 'na stronie AI',
    helpsMorePost: '.',
    faqHeading: 'Najczęstsze pytania',
    faq: [
      {
        q: 'Czy salon potrzebuje osobnej księgowości, skoro ma Booksy?',
        a: 'Tak. Booksy pokazuje rezerwacje i klientki, ale nie liczy zysku netto po materiałach, czynszu, podatkach i wynagrodzeniach. Finkley bierze wizyty z Booksy i dolicza do nich koszty i wynagrodzenia, żebyś widziała realne pieniądze, a nie tylko liczbę wizyt.',
      },
      {
        q: 'Czy Excel wystarczy do księgowości salonu?',
        a: 'Excel działa, dopóki salon jest mały i wszystko mieści się w głowie. Dalej sam nie liczy zysku, trudno go otworzyć z domu, łatwo zgubić i ciężko budować raporty „utarg na pracownika za miesiąc”. Program do księgowości robi to sam i na bieżąco.',
      },
      {
        q: 'Ile kosztuje program do księgowości dla salonu?',
        a: 'Finkley ma demo na 14 dni bez karty, darmowy plan na zawsze (rachunek przychodów) i plany płatne €19–99/mies., które otwierają koszty, raporty, wynagrodzenia, asystenta AI i multi-salon. VAT nie jest naliczany.',
      },
      {
        q: 'Czy potrzebna jest wiedza księgowa?',
        a: 'Nie. Księgowość w Finkley jest opisana zwykłymi słowami: zysk, koszty, wynagrodzenia, marża — z czytelnymi etykietami i podpowiedziami. Księgowy nadal jest potrzebny do rozliczeń z urzędem, ale żeby codziennie widzieć pieniądze salonu, wiedza księgowa nie jest potrzebna.',
      },
    ],
    ctaHeading: 'Zacznij prowadzić księgowość salonu już dziś',
    ctaText: 'Zysk, koszty i wynagrodzenia w jednym miejscu. Bez wiedzy księgowej.',
    ctaButton: 'Zacznij za darmo — 14 dni',
    ctaMicrocopy: 'Bez karty',
    breadcrumbHome: 'Strona główna',
    breadcrumbUseCases: 'Scenariusze',
    breadcrumbSelf: 'Księgowość dla salonu piękności',
  },
}

export const seoPagesContent: Record<Locale, SeoPagesCopy> = { ru, pl }

/**
 * Строит JSON-LD (ItemList + FAQPage + BreadcrumbList) для страницы сравнения.
 * locale-aware URL: RU на корне, PL под /pl. selfUrl/homeUrl/compareUrl —
 * абсолютные URL текущей локали. itemListBooksyUrl — внешний (booksy.com).
 */
export function buildCompareJsonLd(
  copy: CompareCopy,
  locale: Locale,
  origin: string,
): Record<string, unknown>[] {
  const abs = (path: string) => new URL(localizedPath(path, locale), origin).toString()
  const homeUrl = abs('/')
  const itemListLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Finkley vs Booksy',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Finkley',
        description: copy.itemListFinkleyDesc,
        url: origin,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Booksy',
        description: copy.itemListBooksyDesc,
        url: 'https://booksy.com/',
      },
    ],
  }
  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: copy.faq.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  }
  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: copy.breadcrumbHome, item: homeUrl },
      { '@type': 'ListItem', position: 2, name: copy.breadcrumbCompare, item: abs('/compare/') },
      {
        '@type': 'ListItem',
        position: 3,
        name: copy.breadcrumbSelf,
        item: abs('/compare/finkley-vs-booksy/'),
      },
    ],
  }
  return [itemListLd, faqLd, breadcrumbLd]
}

/**
 * Строит JSON-LD (FAQPage + BreadcrumbList) для use-cases-страницы.
 * locale-aware URL: RU на корне, PL под /pl.
 */
export function buildUseCasesJsonLd(
  copy: UseCasesCopy,
  locale: Locale,
  origin: string,
): Record<string, unknown>[] {
  const abs = (path: string) => new URL(localizedPath(path, locale), origin).toString()
  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: copy.faq.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  }
  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: copy.breadcrumbHome, item: abs('/') },
      { '@type': 'ListItem', position: 2, name: copy.breadcrumbUseCases, item: abs('/use-cases/') },
      {
        '@type': 'ListItem',
        position: 3,
        name: copy.breadcrumbSelf,
        item: abs('/use-cases/uchet-dlya-salona-krasoty/'),
      },
    ],
  }
  return [faqLd, breadcrumbLd]
}
