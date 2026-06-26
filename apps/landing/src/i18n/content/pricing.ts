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

/**
 * Лейблы переключателя интервала оплаты (ADR-035). Дефолт — ГОД (показываем
 * скидочную цену /мес). VanillaJS в PricingBody.astro пересчитывает цены.
 */
export type IntervalCopy = {
  /** «Год · −15%» */
  year: string
  /** «Месяц» */
  month: string
  /** Бейдж скидки «−15%». */
  yearBadge: string
  /** Подпись под скидочной ценой: «при оплате за год». */
  perMonthAnnual: string
}

export type Faq = { q: string; a: string }

export type PricingCopy = {
  title: string
  description: string
  h1: string
  subtitle: string
  riskReversal: string[]
  interval: IntervalCopy
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
    'Тарифы Finkley для салонов красоты: бесплатный план навсегда, демо 14 дней без карты и платные планы от €19/мес. Отмена в один клик.',
  h1: 'Простые тарифы. Платите только за то, чем пользуетесь.',
  subtitle:
    'Демо 14 дней без карты, бесплатный тариф навсегда и платные планы от €19/мес — это меньше стоимости одного маникюра в месяц за то, чтобы всегда видеть чистую прибыль салона.',
  riskReversal: ['Без карты на старте', 'Отмена в один клик', 'Возврат денег в первые 14 дней'],
  interval: {
    year: 'Год',
    month: 'Месяц',
    yearBadge: '−15%',
    perMonthAnnual: 'при оплате за год',
  },
  freePlans: [
    {
      name: 'Бесплатный',
      price: '€0',
      note: 'навсегда',
      badge: 'Навсегда бесплатно',
      blurb: 'Базовый учёт доходов — бесплатно навсегда.',
      cta: 'Начать бесплатно',
      features: [
        'Доходы: визиты, выручка, средний чек',
        'Дашборд с ключевыми цифрами салона',
        'Бесплатно навсегда, без карты',
        'Апгрейд на любой тариф в один клик',
      ],
    },
  ],
  paidPlans: [
    {
      name: 'Старт',
      price: '€19',
      period: '/ мес',
      highlight: false,
      blurb: 'Все деньги салона под контролем.',
      cta: 'Выбрать',
      features: [
        'Всё из бесплатного',
        'Расходы: скан чеков, надиктовка, банк',
        'Отчёты: маржа, мастера, возвраты',
        'Мессенджеры в одной ленте',
        'Интеграции: Booksy, банки, бухгалтерия',
      ],
    },
    {
      name: 'Рост',
      price: '€49',
      period: '/ мес',
      highlight: false,
      blurb: 'Возвращайте клиентов и растите выручку.',
      cta: 'Выбрать',
      features: [
        'Всё из тарифа €19',
        'Маркетинг: рассылки, акции, напоминания',
        'AI-помощник по прибыли + голосовой ввод',
        'Авто-запросы отзывов после визита',
      ],
    },
    {
      name: 'Полный',
      price: '€69',
      period: '/ мес',
      highlight: true,
      blurb: 'Весь продукт без ограничений.',
      cta: 'Выбрать',
      features: [
        'Всё из тарифа €49',
        'Финансы: P&L, ДДС, чистая прибыль',
        'Склад: остатки, списания, накладные',
        'Бюджеты: план/факт',
        'Приоритетная поддержка',
      ],
    },
    {
      name: 'Сеть',
      price: '€99',
      period: '/ мес',
      highlight: false,
      blurb: 'Несколько салонов на одном аккаунте.',
      cta: 'Выбрать',
      features: [
        'Всё из тарифа €69',
        'Несколько салонов + переключатель',
        'Раздельный учёт и отчёты',
        'Сравнение салонов',
      ],
    },
  ],
  popularBadge: 'Популярный',
  finePrint:
    'Цены окончательные. Платишь ровно сумму тарифа. Платежи через Stripe · Visa / Mastercard.',
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
  title: 'Cennik Finkley — księgowość dla salonu piękności od €19/mies.',
  description:
    'Plany Finkley dla salonów piękności: darmowy plan na zawsze, demo 14 dni bez karty i plany płatne od €19/mies. Anulujesz jednym kliknięciem.',
  h1: 'Proste plany. Płacisz tylko za to, z czego korzystasz.',
  subtitle:
    'Demo 14 dni bez karty, darmowy plan na zawsze i plany płatne od €19/mies. — to mniej niż jeden manicure miesięcznie za to, by zawsze mieć przed oczami zysk netto swojego salonu.',
  riskReversal: [
    'Na start bez karty',
    'Anulujesz jednym kliknięciem',
    'Zwrot pieniędzy w pierwszych 14 dniach',
  ],
  interval: {
    year: 'Rok',
    month: 'Miesiąc',
    yearBadge: '−15%',
    perMonthAnnual: 'przy płatności rocznej',
  },
  freePlans: [
    {
      name: 'Darmowy',
      price: '€0',
      note: 'na zawsze',
      badge: 'Na zawsze za darmo',
      blurb: 'Podstawowy rachunek przychodów — za darmo na zawsze.',
      cta: 'Zacznij za darmo',
      features: [
        'Przychody: wizyty, utarg, średni rachunek',
        'Pulpit z kluczowymi liczbami salonu',
        'Za darmo na zawsze, bez karty',
        'Wyższy plan jednym kliknięciem',
      ],
    },
  ],
  paidPlans: [
    {
      name: 'Start',
      price: '€19',
      period: '/ mies.',
      highlight: false,
      blurb: 'Wszystkie pieniądze salonu pod kontrolą.',
      cta: 'Wybierz',
      features: [
        'Wszystko z planu darmowego',
        'Koszty: skan paragonów, dyktowanie, bank',
        'Raporty: marża, pracownicy, zwroty',
        'Komunikatory w jednej skrzynce',
        'Integracje: Booksy, banki, księgowość',
      ],
    },
    {
      name: 'Wzrost',
      price: '€49',
      period: '/ mies.',
      highlight: false,
      blurb: 'Odzyskuj klientki i zwiększaj utarg.',
      cta: 'Wybierz',
      features: [
        'Wszystko z planu €19',
        'Marketing: wysyłki, promocje, przypomnienia',
        'Asystent AI od zysku + wpisywanie głosem',
        'Auto-prośby o opinię po wizycie',
      ],
    },
    {
      name: 'Pełny',
      price: '€69',
      period: '/ mies.',
      highlight: true,
      blurb: 'Cały produkt bez ograniczeń.',
      cta: 'Wybierz',
      features: [
        'Wszystko z planu €49',
        'Finanse: P&L, przepływy, zysk netto',
        'Magazyn: stany, odpisy, faktury',
        'Budżety: plan/fakt',
        'Priorytetowe wsparcie',
      ],
    },
    {
      name: 'Sieć',
      price: '€99',
      period: '/ mies.',
      highlight: false,
      blurb: 'Kilka salonów na jednym koncie.',
      cta: 'Wybierz',
      features: [
        'Wszystko z planu €69',
        'Kilka salonów + przełącznik',
        'Osobne rozliczenia i raporty',
        'Porównanie salonów',
      ],
    },
  ],
  popularBadge: 'Popularny',
  finePrint:
    'Ceny ostateczne. Płacisz dokładnie tyle, ile wynosi plan. Płatności przez Stripe · Visa / Mastercard.',
  faqHeading: 'Płatności — najczęstsze pytania',
  faq: [
    {
      q: 'Czym demo różni się od planu darmowego?',
      a: 'Demo to pełna funkcjonalność bez ograniczeń przez 14 dni, żebyś mogła wszystko wypróbować. Karta nie jest potrzebna. Plan darmowy działa na zawsze, ale otwarta jest w nim tylko sekcja „Przychody" (wizyty i utarg) — pozostałe sekcje widzisz, ale są zablokowane. W każdej chwili możesz przejść na plan płatny.',
    },
    {
      q: 'A co po 14 dniach demo?',
      a: '12. dnia przypomnimy Ci mailem. Możesz wybrać plan płatny i korzystać dalej ze wszystkich sekcji albo zostać na planie darmowym — wtedy zostanie Ci sekcja „Przychody", a pozostałe się zablokują. Twoje dane nigdzie nie znikną. Subskrypcję możesz włączyć w dowolnym momencie.',
    },
    {
      q: 'Który plan wybrać?',
      a: '€19 — jeśli potrzebujesz rachunku przychodów, kosztów, raportów i komunikatora. €49 (najpopularniejszy) dodaje marketing i asystenta AI. €69 otwiera wszystko, w tym finanse (P&L i przepływy pieniężne) oraz magazyn. €99 — jeśli masz kilka salonów na jednym koncie. Plan możesz zmienić w dowolnej chwili.',
    },
    {
      q: 'A jeśli mam kilka salonów?',
      a: 'Multi-salon należy do planu €99/mies.: jedno konto, przełącznik salonów w nagłówku, każdy salon liczony osobno. W pozostałych planach jest jeden salon na konto.',
    },
    {
      q: 'Czy mogę anulować subskrypcję?',
      a: 'Tak, jednym kliknięciem w Ustawienia → Subskrypcja. Do końca opłaconego okresu plan działa normalnie, a potem konto przechodzi na plan darmowy (zostaje Ci sekcja „Przychody").',
    },
    {
      q: 'A zwroty?',
      a: 'Jeśli w pierwszych 14 dniach opłaconej subskrypcji coś pójdzie nie tak — zwrócimy Ci pieniądze. Napisz na info@finkley.app.',
    },
  ],
  productDescription:
    'Rachunkowość zarządcza i analityka dla salonów piękności: przychody, koszty, wynagrodzenia, zysk, raporty i asystent AI.',
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
