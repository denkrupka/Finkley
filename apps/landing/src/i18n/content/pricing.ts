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
    year: 'Год · −15%',
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
      blurb: 'Полный учёт денег: доходы, расходы, отчёты и переписка с клиентами.',
      cta: 'Выбрать',
      features: [
        'Всё из бесплатного',
        'Расходы: учёт трат по категориям, скан чеков и надиктовка, привязка к банку',
        'Отчёты: маржа по услугам, эффективность мастеров, возвращаемость клиентов',
        'Мессенджер: Instagram, Facebook, Telegram, WhatsApp в одной ленте',
        'Все интеграции: Booksy, Fresha, Treatwell, банки (PSD2), бухгалтерия (wFirma, KSeF)',
      ],
    },
    {
      name: 'Рост',
      price: '€49',
      period: '/ мес',
      highlight: false,
      blurb: 'Учёт плюс возврат клиентов рассылками и AI-помощник по прибыли.',
      cta: 'Выбрать',
      features: [
        'Всё из тарифа €19',
        'Маркетинг: SMS и email-рассылки, акции, напоминания о визите и возврат «спящих»',
        'AI-помощник: разбор салона, советы по прибыли, добавление визитов и расходов голосом',
        'Запросы отзывов после визита автоматически',
      ],
    },
    {
      name: 'Полный',
      price: '€69',
      period: '/ мес',
      highlight: true,
      blurb: 'Все разделы продукта, включая финансы и склад.',
      cta: 'Выбрать',
      features: [
        'Всё из тарифа €49',
        'Финансы: P&L, ДДС (движение денег), план/факт и чистая прибыль',
        'Склад: остатки, списания, низкие остатки, скан накладных',
        'Бюджеты: план доходов и расходов с контролем факта',
        'Приоритетная поддержка',
      ],
    },
    {
      name: 'Сеть',
      price: '€99',
      period: '/ мес',
      highlight: false,
      blurb: 'Всё из «Полного» плюс несколько салонов на одном аккаунте.',
      cta: 'Выбрать',
      features: [
        'Всё из тарифа €69',
        'Несколько салонов на одном аккаунте, переключатель в шапке',
        'Раздельный учёт и отчёты по каждому салону',
        'Сравнение салонов между собой',
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
    year: 'Rok · −15%',
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
      blurb:
        'Podstawowy rachunek przychodów bez limitu czasu. Pozostałe sekcje widzisz, ale są zablokowane.',
      cta: 'Zacznij za darmo',
      features: [
        'Sekcja „Przychody": wizyty i utarg',
        'Pozostałe sekcje widoczne, ale zablokowane',
        'Bez limitu czasu',
        'Przejście na wyższy plan jednym kliknięciem w dowolnej chwili',
      ],
    },
  ],
  paidPlans: [
    {
      name: 'Start',
      price: '€19',
      period: '/ mies.',
      highlight: false,
      blurb: 'Pełna kontrola nad pieniędzmi: przychody, koszty, raporty i rozmowy z klientkami.',
      cta: 'Wybierz',
      features: [
        'Wszystko z planu darmowego',
        'Koszty: wydatki wg kategorii, skan paragonów i dyktowanie głosem, dopasowanie do banku',
        'Raporty: marża na usłudze, wyniki pracowników, powracalność klientek',
        'Komunikator: Instagram, Facebook, Telegram, WhatsApp w jednej skrzynce',
        'Wszystkie integracje: Booksy, Fresha, Treatwell, banki (PSD2), księgowość (wFirma, KSeF)',
      ],
    },
    {
      name: 'Wzrost',
      price: '€49',
      period: '/ mies.',
      highlight: false,
      blurb: 'Kontrola finansów plus odzyskiwanie klientek wysyłkami i asystent AI od zysku.',
      cta: 'Wybierz',
      features: [
        'Wszystko z planu €19',
        'Marketing: wysyłki SMS i e-mail, promocje, przypomnienia o wizycie i odzyskiwanie „uśpionych"',
        'Asystent AI: analiza salonu, porady o zysku, dodawanie wizyt i kosztów głosem',
        'Automatyczne prośby o opinię po wizycie',
      ],
    },
    {
      name: 'Pełny',
      price: '€69',
      period: '/ mies.',
      highlight: true,
      blurb: 'Wszystkie sekcje produktu, łącznie z finansami i magazynem.',
      cta: 'Wybierz',
      features: [
        'Wszystko z planu €49',
        'Finanse: P&L, przepływy pieniężne, plan/fakt i zysk netto',
        'Magazyn: stany, odpisy, niskie stany, skan faktur',
        'Budżety: plan przychodów i kosztów z kontrolą faktu',
        'Priorytetowe wsparcie',
      ],
    },
    {
      name: 'Sieć',
      price: '€99',
      period: '/ mies.',
      highlight: false,
      blurb: 'Wszystko z planu Pełny plus kilka salonów na jednym koncie.',
      cta: 'Wybierz',
      features: [
        'Wszystko z planu €69',
        'Kilka salonów na jednym koncie, przełącznik w nagłówku',
        'Osobne rozliczenia i raporty dla każdego salonu',
        'Porównanie salonów między sobą',
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
