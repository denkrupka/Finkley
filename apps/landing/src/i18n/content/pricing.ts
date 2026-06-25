/**
 * Контент страницы тарифов по локалям (B-prime: один shared-шаблон
 * PricingBody.astro рендерит обе локали из этого модуля).
 *
 * RU — источник истины (verbatim из прежней pricing.astro). PL — ЧЕРНОВИК
 * перевода, ТРЕБУЕТ ВЫЧИТКИ НОСИТЕЛЕМ перед публикацией (owner-гейт).
 * Цены (€0/€19/…) локале-инвариантны.
 */
import type { Locale } from '../routing'

export type Plan = {
  name: string
  price: string
  /** Для free-карточек: «14 дней» / «навсегда». */
  note?: string
  /** Для платных карточек: «/ мес». */
  period?: string
  badge?: string
  highlight?: boolean
  blurb: string
  cta: string
  features: string[]
}

export type Faq = { q: string; a: string }

export type PricingCopy = {
  title: string
  description: string
  h1: string
  subtitle: string
  riskReversal: string[]
  freePlans: Plan[]
  paidPlans: Plan[]
  popularBadge: string
  finePrint: string
  faqHeading: string
  faq: Faq[]
  productDescription: string
  breadcrumbHome: string
  breadcrumbPricing: string
}

const ru: PricingCopy = {
  title: 'Цены Finkley — учёт для салона красоты от €19/мес',
  description:
    'Тарифы Finkley для салонов красоты: бесплатный план навсегда, демо 14 дней без карты и платные планы от €19/мес. НДС не взимается, отмена в один клик.',
  h1: 'Простые тарифы. Платите только за то, чем пользуетесь.',
  subtitle:
    'Демо 14 дней без карты, бесплатный тариф навсегда и платные планы от €19/мес — это меньше стоимости одного маникюра в месяц за то, чтобы всегда видеть чистую прибыль салона.',
  riskReversal: [
    'Без карты на старте',
    'Отмена в один клик',
    'Возврат денег в первые 14 дней',
    'НДС не взимается',
  ],
  freePlans: [
    {
      name: 'Демо',
      price: '€0',
      note: '14 дней',
      badge: '14 дней бесплатно, без карты',
      blurb: 'Весь функционал без ограничений на 14 дней. Карта не нужна.',
      cta: 'Начать бесплатно',
      features: [
        'Все разделы и интеграции',
        'Без лимитов на 14 дней',
        'Без привязки карты',
        'После — выбери любой тариф',
      ],
    },
    {
      name: 'Бесплатный',
      price: '€0',
      note: 'навсегда',
      badge: 'Навсегда бесплатно',
      blurb: 'Базовый учёт доходов без срока. Остальные разделы видно, но они заблокированы.',
      cta: 'Начать бесплатно',
      features: [
        'Раздел «Доходы»: визиты и выручка',
        'Остальные разделы видны, но заблокированы',
        'Без срока действия',
        'Апгрейд в один клик в любой момент',
      ],
    },
  ],
  paidPlans: [
    {
      name: 'Старт',
      price: '€19',
      period: '/ мес',
      highlight: false,
      blurb: 'Полный учёт денег: доходы, расходы и отчётность.',
      cta: 'Выбрать',
      features: [
        'Всё из бесплатного',
        'Раздел «Расходы»',
        'Раздел «Отчёты»',
        'Раздел «Мессенджер»',
      ],
    },
    {
      name: 'Рост',
      price: '€49',
      period: '/ мес',
      highlight: true,
      blurb: 'Учёт плюс привлечение клиентов и AI-помощник.',
      cta: 'Выбрать',
      features: ['Всё из тарифа €19', 'Раздел «Маркетинг»', 'AI-помощник'],
    },
    {
      name: 'Полный',
      price: '€69',
      period: '/ мес',
      highlight: false,
      blurb: 'Все разделы продукта, включая финансы и склад.',
      cta: 'Выбрать',
      features: [
        'Всё из тарифа €49',
        'Раздел «Финансы»: P&L и ДДС',
        'Раздел «Склад»',
        'Все интеграции',
      ],
    },
    {
      name: 'Сеть',
      price: '€99',
      period: '/ мес',
      highlight: false,
      blurb: 'Для нескольких салонов на одном аккаунте.',
      cta: 'Выбрать',
      features: [
        'Всё из тарифа €69',
        'Несколько салонов на одном аккаунте',
        'Переключатель салонов в шапке',
        'Каждый салон считается отдельно',
      ],
    },
  ],
  popularBadge: 'Популярный',
  finePrint:
    'Цены окончательные — НДС не взимается. Платишь ровно сумму тарифа. Платежи через Stripe · Visa / Mastercard.',
  faqHeading: 'Про оплату — частые вопросы',
  faq: [
    {
      q: 'Чем демо отличается от бесплатного тарифа?',
      a: 'Демо — это весь функционал без ограничений на 14 дней, чтобы попробовать всё. Карта не нужна. Бесплатный тариф действует навсегда, но в нём открыт только раздел «Доходы» (учёт визитов и выручки) — остальные разделы видны, но заблокированы. В любой момент можно перейти на платный тариф.',
    },
    {
      q: 'А что после 14 дней демо?',
      a: 'На 12-й день мы напомним по email. Можно выбрать платный тариф и продолжить со всеми разделами, либо остаться на бесплатном тарифе — тогда останется доступен раздел «Доходы», а остальные разделы заблокируются. Данные никуда не денутся. Подписаться можно в любой момент.',
    },
    {
      q: 'Какой тариф выбрать?',
      a: '€19 — если нужен учёт доходов, расходов, отчёты и мессенджер. €49 (самый популярный) добавляет маркетинг и AI-помощника. €69 открывает всё, включая финансы (P&L и ДДС) и склад. €99 — если у тебя несколько салонов на одном аккаунте. Перейти между тарифами можно в любой момент.',
    },
    {
      q: 'Если у меня несколько салонов?',
      a: 'Мульти-салон входит в тариф €99/мес: один аккаунт, переключатель салонов в шапке, каждый салон считается отдельно. На остальных тарифах — один салон на аккаунт.',
    },
    {
      q: 'Цены с НДС или без?',
      a: 'НДС не взимается — в чеке ровно сумма тарифа, без налога сверху. Цены окончательные.',
    },
    {
      q: 'Можно отменить подписку?',
      a: 'Да, в один клик в Настройках → Подписка. До конца оплаченного периода тариф работает как обычно, потом аккаунт переходит на бесплатный тариф (остаётся раздел «Доходы»).',
    },
    {
      q: 'Возвраты?',
      a: 'Если что-то пошло не так в первые 14 дней оплаченной подписки — вернём деньги. Напиши на info@finkley.app.',
    },
  ],
  productDescription:
    'Управленческий учёт и аналитика для салонов красоты: доходы, расходы, зарплаты, прибыль, отчёты и AI-помощник.',
  breadcrumbHome: 'Главная',
  breadcrumbPricing: 'Цены',
}

// ⚠️ PL — машинный черновик, ТРЕБУЕТ ВЫЧИТКИ НОСИТЕЛЕМ ПОЛЬСКОГО перед публикацией.
const pl: PricingCopy = {
  title: 'Cennik Finkley — księgowość dla salonu od €19/mies.',
  description:
    'Plany Finkley dla salonów piękności: darmowy plan na zawsze, demo 14 dni bez karty i plany płatne od €19/mies. Bez VAT, anulowanie jednym kliknięciem.',
  h1: 'Proste plany. Płacisz tylko za to, czego używasz.',
  subtitle:
    'Demo 14 dni bez karty, darmowy plan na zawsze i plany płatne od €19/mies — to mniej niż jeden manicure miesięcznie, by zawsze widzieć zysk netto salonu.',
  riskReversal: [
    'Bez karty na start',
    'Anulowanie jednym kliknięciem',
    'Zwrot pieniędzy w pierwsze 14 dni',
    'Bez VAT',
  ],
  freePlans: [
    {
      name: 'Demo',
      price: '€0',
      note: '14 dni',
      badge: '14 dni za darmo, bez karty',
      blurb: 'Pełna funkcjonalność bez ograniczeń przez 14 dni. Karta nie jest potrzebna.',
      cta: 'Zacznij za darmo',
      features: [
        'Wszystkie sekcje i integracje',
        'Bez limitów przez 14 dni',
        'Bez podawania karty',
        'Potem — wybierz dowolny plan',
      ],
    },
    {
      name: 'Darmowy',
      price: '€0',
      note: 'na zawsze',
      badge: 'Na zawsze za darmo',
      blurb:
        'Podstawowa księgowość przychodów bez limitu czasu. Pozostałe sekcje widoczne, ale zablokowane.',
      cta: 'Zacznij za darmo',
      features: [
        'Sekcja „Przychody": wizyty i utarg',
        'Pozostałe sekcje widoczne, ale zablokowane',
        'Bez limitu czasu',
        'Upgrade jednym kliknięciem w dowolnej chwili',
      ],
    },
  ],
  paidPlans: [
    {
      name: 'Start',
      price: '€19',
      period: '/ mies.',
      highlight: false,
      blurb: 'Pełna księgowość pieniędzy: przychody, koszty i raporty.',
      cta: 'Wybierz',
      features: [
        'Wszystko z darmowego',
        'Sekcja „Koszty"',
        'Sekcja „Raporty"',
        'Sekcja „Komunikator"',
      ],
    },
    {
      name: 'Wzrost',
      price: '€49',
      period: '/ mies.',
      highlight: true,
      blurb: 'Księgowość plus pozyskiwanie klientów i asystent AI.',
      cta: 'Wybierz',
      features: ['Wszystko z planu €19', 'Sekcja „Marketing"', 'Asystent AI'],
    },
    {
      name: 'Pełny',
      price: '€69',
      period: '/ mies.',
      highlight: false,
      blurb: 'Wszystkie sekcje produktu, w tym finanse i magazyn.',
      cta: 'Wybierz',
      features: [
        'Wszystko z planu €49',
        'Sekcja „Finanse": P&L i przepływy',
        'Sekcja „Magazyn"',
        'Wszystkie integracje',
      ],
    },
    {
      name: 'Sieć',
      price: '€99',
      period: '/ mies.',
      highlight: false,
      blurb: 'Dla kilku salonów na jednym koncie.',
      cta: 'Wybierz',
      features: [
        'Wszystko z planu €69',
        'Kilka salonów na jednym koncie',
        'Przełącznik salonów w nagłówku',
        'Każdy salon liczony osobno',
      ],
    },
  ],
  popularBadge: 'Popularny',
  finePrint:
    'Ceny ostateczne — bez VAT. Płacisz dokładnie kwotę planu. Płatności przez Stripe · Visa / Mastercard.',
  faqHeading: 'O płatnościach — częste pytania',
  faq: [
    {
      q: 'Czym demo różni się od planu darmowego?',
      a: 'Demo to pełna funkcjonalność bez ograniczeń przez 14 dni, by wszystko wypróbować. Karta nie jest potrzebna. Plan darmowy działa na zawsze, ale otwarta jest w nim tylko sekcja „Przychody" (wizyty i utarg) — pozostałe sekcje są widoczne, ale zablokowane. W każdej chwili można przejść na plan płatny.',
    },
    {
      q: 'A co po 14 dniach demo?',
      a: '12. dnia przypomnimy mailem. Można wybrać plan płatny i kontynuować ze wszystkimi sekcjami albo zostać na planie darmowym — wtedy pozostanie dostępna sekcja „Przychody", a pozostałe się zablokują. Dane nigdzie nie znikną. Subskrybować można w dowolnym momencie.',
    },
    {
      q: 'Który plan wybrać?',
      a: '€19 — jeśli potrzebujesz księgowości przychodów, kosztów, raportów i komunikatora. €49 (najpopularniejszy) dodaje marketing i asystenta AI. €69 otwiera wszystko, w tym finanse (P&L i przepływy) oraz magazyn. €99 — jeśli masz kilka salonów na jednym koncie. Plany można zmieniać w dowolnej chwili.',
    },
    {
      q: 'A jeśli mam kilka salonów?',
      a: 'Multi-salon wchodzi w plan €99/mies.: jedno konto, przełącznik salonów w nagłówku, każdy salon liczony osobno. W pozostałych planach — jeden salon na konto.',
    },
    {
      q: 'Ceny z VAT czy bez?',
      a: 'VAT nie jest naliczany — na rachunku jest dokładnie kwota planu, bez podatku na wierzchu. Ceny są ostateczne.',
    },
    {
      q: 'Czy można anulować subskrypcję?',
      a: 'Tak, jednym kliknięciem w Ustawienia → Subskrypcja. Do końca opłaconego okresu plan działa normalnie, potem konto przechodzi na plan darmowy (zostaje sekcja „Przychody").',
    },
    {
      q: 'Zwroty?',
      a: 'Jeśli coś poszło nie tak w pierwsze 14 dni opłaconej subskrypcji — zwrócimy pieniądze. Napisz na info@finkley.app.',
    },
  ],
  productDescription:
    'Księgowość zarządcza i analityka dla salonów piękności: przychody, koszty, wynagrodzenia, zysk, raporty i asystent AI.',
  breadcrumbHome: 'Strona główna',
  breadcrumbPricing: 'Cennik',
}

export const pricingContent: Record<Locale, PricingCopy> = { ru, pl }

/**
 * Строит JSON-LD (Product + FAQPage + BreadcrumbList) для страницы тарифов.
 * selfUrl/homeUrl — абсолютные URL текущей локали (RU /pricing, PL /pl/pricing).
 * Рендерится в <head> через Layout jsonLd-проп.
 */
export function buildPricingJsonLd(
  copy: PricingCopy,
  selfUrl: string,
  homeUrl: string,
): Record<string, unknown>[] {
  const priceToNumber = (p: string) => p.replace(/[^\d]/g, '')
  const productLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Finkley',
    description: copy.productDescription,
    brand: { '@type': 'Brand', name: 'Finkley' },
    offers: [...copy.freePlans, ...copy.paidPlans].map((plan) => ({
      '@type': 'Offer',
      name: `Finkley ${plan.name}`,
      price: priceToNumber(plan.price),
      priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock',
      url: selfUrl,
      description: plan.blurb,
    })),
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
      { '@type': 'ListItem', position: 2, name: copy.breadcrumbPricing, item: selfUrl },
    ],
  }
  return [productLd, faqLd, breadcrumbLd]
}
