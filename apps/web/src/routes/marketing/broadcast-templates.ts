/**
 * Готовые шаблоны для рассылок. Кнопка в UI клик-заполняет SMS + email subject +
 * email body одним нажатием. Юзер потом редактирует под себя.
 *
 * Шаблоны персонализированы — используют переменные:
 *   {name}        — полное имя клиента
 *   {firstName}   — только первое имя
 *   {salon}       — название салона
 *   {date}        — сегодняшняя дата в локали
 *
 * Подстановка происходит на бэкенде marketing-send-broadcast.ts. Если у клиента
 * нет имени — fallback на 'клиент'.
 *
 * Email-тела — карточный inline-styled HTML который корректно рендерят Gmail,
 * Outlook, Apple Mail (всё в inline стилях, никаких <style>, CTA-кнопки через
 * div+border-radius — даже без поддержки CSS будут читаемы).
 *
 * 3 локали: RU / EN / PL.
 */

export type BroadcastTemplate = {
  id: string
  label: string
  emoji: string
  sms: string
  subject: string
  bodyHtml: string
}

/** Базовый layout email: контейнер с тенью + brand-цвета + footer. */
function emailCard(opts: {
  accentBg: string
  accentText: string
  emoji: string
  heading: string
  body: string
  ctaLabel: string
  signature: string
}): string {
  return `<div style="max-width:560px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);border:1px solid #eef0f4">
  <div style="background:${opts.accentBg};padding:36px 32px;text-align:center">
    <div style="font-size:48px;line-height:1;margin-bottom:8px">${opts.emoji}</div>
    <h1 style="margin:0;color:${opts.accentText};font-size:24px;font-weight:700;letter-spacing:-0.5px">${opts.heading}</h1>
  </div>
  <div style="padding:28px 32px;color:#1a2540;font-size:15px;line-height:1.65">
    ${opts.body}
    <div style="text-align:center;margin:28px 0 8px">
      <a href="#" style="display:inline-block;background:#1a2540;color:#ffffff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;letter-spacing:0.2px">${opts.ctaLabel}</a>
    </div>
  </div>
  <div style="background:#fafbfc;padding:16px 32px;text-align:center;border-top:1px solid #eef0f4">
    <p style="margin:0;color:#7a8294;font-size:13px;line-height:1.5">${opts.signature}</p>
  </div>
</div>`
}

const TEMPLATES_RU: BroadcastTemplate[] = [
  {
    id: 'promo20',
    label: 'Акция −20%',
    emoji: '💸',
    sms: '{salon}: {firstName}, −20% на маникюр всю эту неделю! Запишись в ответ или по ссылке.',
    subject: '{firstName}, −20% на маникюр — только до воскресенья 💸',
    bodyHtml: emailCard({
      accentBg: '#fef3c7',
      accentText: '#1a2540',
      emoji: '💸',
      heading: 'Неделя выгоды',
      body: `<p style="margin:0 0 14px">Привет, <strong>{firstName}</strong>!</p>
<p style="margin:0 0 14px">У нас неделя выгодных предложений — всё это время делаем <strong style="color:#d97706">−20% на классический и гель-маникюр</strong>.</p>
<p style="margin:0 0 14px">Идеальный момент освежить руки перед выходными — приходи к нам ✨</p>`,
      ctaLabel: 'Записаться на маникюр',
      signature: 'Спасибо что выбираешь {salon} ❤️',
    }),
  },
  {
    id: 'birthday',
    label: 'День рождения',
    emoji: '🎂',
    sms: '{firstName}, с Днём рождения от {salon}! 🎉 Дарим −30% на любую услугу всю эту неделю — твой подарок ждёт.',
    subject: '{firstName}, с Днём рождения! Наш подарок — внутри 🎁',
    bodyHtml: emailCard({
      accentBg: '#fce7f3',
      accentText: '#9d174d',
      emoji: '🎂',
      heading: 'С Днём рождения, {firstName}!',
      body: `<p style="margin:0 0 14px">Желаем тебе яркого года, новых побед и моментов, к которым хочется возвращаться.</p>
<p style="margin:0 0 14px">А чтобы праздник был ещё ярче — дарим <strong style="color:#d97706">−30% на любую процедуру</strong>. Промо действует всю неделю с твоего дня рождения.</p>
<p style="margin:0 0 0;color:#7a8294;font-size:13px">Просто запишись и скажи администратору при визите.</p>`,
      ctaLabel: 'Записаться на подарок',
      signature: 'С любовью, команда {salon} ❤️',
    }),
  },
  {
    id: 'winback',
    label: 'Возвращайся',
    emoji: '💌',
    sms: '{firstName}, давно не виделись! {salon} скучает. Возвращайся на маникюр — у нас новые цвета сезона 💅',
    subject: '{firstName}, мы скучаем 💌',
    bodyHtml: emailCard({
      accentBg: '#e0f2fe',
      accentText: '#0c4a6e',
      emoji: '💌',
      heading: '{firstName}, давно не виделись',
      body: `<p style="margin:0 0 14px">Хотим напомнить о себе и предложить вернуться. За это время:</p>
<ul style="margin:0 0 14px;padding-left:24px;line-height:1.8">
  <li>📌 Обновили коллекцию цветов сезона</li>
  <li>📌 Обновили меню процедур</li>
  <li>📌 К команде пришли новые мастера</li>
</ul>
<p style="margin:0 0 14px">Возвращайся — и мы сделаем визит особенным.</p>`,
      ctaLabel: 'Записаться сейчас',
      signature: 'До встречи, {salon}',
    }),
  },
  {
    id: 'new_service',
    label: 'Новая услуга',
    emoji: '✨',
    sms: '{firstName}, в {salon} новая услуга! Запишись по ссылке и попробуй первой по специальной цене.',
    subject: 'Новинка в {salon} — {firstName}, посмотри ✨',
    bodyHtml: emailCard({
      accentBg: '#ede9fe',
      accentText: '#5b21b6',
      emoji: '✨',
      heading: 'Встречай новинку',
      body: `<p style="margin:0 0 14px">Привет, <strong>{firstName}</strong>!</p>
<p style="margin:0 0 14px">Мы расширили меню — теперь у нас новая процедура, которую очень советуем попробовать.</p>
<p style="margin:0 0 14px">Для всех клиентов кто запишется в течение 7 дней — <strong style="color:#d97706">специальная стартовая цена</strong>.</p>`,
      ctaLabel: 'Записаться первой',
      signature: '{salon} · {date}',
    }),
  },
  {
    id: 'seasonal',
    label: 'Сезонная распродажа',
    emoji: '🍂',
    sms: '{firstName}, сезонная распродажа в {salon}! Скидки до 35% на топ-услуги — только эту неделю.',
    subject: 'Сезонная распродажа: до −35% — {firstName}, успей 🍂',
    bodyHtml: emailCard({
      accentBg: '#fed7aa',
      accentText: '#7c2d12',
      emoji: '🍂',
      heading: 'Сезонная распродажа',
      body: `<p style="margin:0 0 14px">Привет, <strong>{firstName}</strong>! Готовимся к новому сезону вместе. На этой неделе скидки на топовые процедуры — <strong style="color:#c2410c">до −35%</strong>.</p>
<table style="width:100%;margin:0 0 14px;border-collapse:collapse">
  <tr><td style="padding:8px 0;border-bottom:1px solid #fed7aa">Маникюр + педикюр в комплексе</td><td style="padding:8px 0;border-bottom:1px solid #fed7aa;text-align:right;font-weight:700;color:#c2410c">−25%</td></tr>
  <tr><td style="padding:8px 0;border-bottom:1px solid #fed7aa">Покрытие гель-лаком</td><td style="padding:8px 0;border-bottom:1px solid #fed7aa;text-align:right;font-weight:700;color:#c2410c">−20%</td></tr>
  <tr><td style="padding:8px 0">Окрашивание бровей</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#c2410c">−35%</td></tr>
</table>`,
      ctaLabel: 'Записаться сейчас',
      signature: 'Только до конца недели · {salon}',
    }),
  },
  {
    id: 'holiday',
    label: 'Праздничная акция',
    emoji: '🎁',
    sms: '{firstName}, праздник близко 🎁 {salon}: запишись заранее — лучшие слоты разбирают первыми.',
    subject: 'Праздничные слоты заканчиваются — {firstName}, успей 🎁',
    bodyHtml: emailCard({
      accentBg: '#fee2e2',
      accentText: '#991b1b',
      emoji: '🎁',
      heading: 'Праздник близко',
      body: `<p style="margin:0 0 14px">Привет, <strong>{firstName}</strong>!</p>
<p style="margin:0 0 14px">Хорошие слоты разбирают первыми, а перед праздниками поток клиентов всегда плотный. Запишись заранее, чтобы получить любимое время.</p>
<p style="margin:0 0 14px">А для тех кто запишется на этой неделе — <strong style="color:#dc2626">бонусная процедура в подарок</strong> 🎁</p>`,
      ctaLabel: 'Записаться к празднику',
      signature: '{salon} ждёт тебя',
    }),
  },
]

const TEMPLATES_PL: BroadcastTemplate[] = [
  {
    id: 'promo20',
    label: 'Promocja −20%',
    emoji: '💸',
    sms: '{salon}: {firstName}, −20% na manicure cały tydzień! Zapisz się w odpowiedzi lub po linku.',
    subject: '{firstName}, −20% na manicure — tylko do niedzieli 💸',
    bodyHtml: emailCard({
      accentBg: '#fef3c7',
      accentText: '#1a2540',
      emoji: '💸',
      heading: 'Tydzień korzystnych ofert',
      body: `<p style="margin:0 0 14px">Cześć, <strong>{firstName}</strong>!</p>
<p style="margin:0 0 14px">Mamy tydzień promocji — przez cały ten czas <strong style="color:#d97706">−20% na manicure klasyczny i hybrydowy</strong>.</p>
<p style="margin:0 0 14px">Idealny moment, by odświeżyć paznokcie przed weekendem ✨</p>`,
      ctaLabel: 'Zapisz się na manicure',
      signature: 'Dziękujemy że wybierasz {salon} ❤️',
    }),
  },
  {
    id: 'birthday',
    label: 'Urodziny',
    emoji: '🎂',
    sms: '{firstName}, wszystkiego najlepszego od {salon}! 🎉 −30% na dowolną usługę cały tydzień — twój prezent czeka.',
    subject: '{firstName}, wszystkiego najlepszego! Prezent w środku 🎁',
    bodyHtml: emailCard({
      accentBg: '#fce7f3',
      accentText: '#9d174d',
      emoji: '🎂',
      heading: 'Wszystkiego najlepszego, {firstName}!',
      body: `<p style="margin:0 0 14px">Życzymy Ci jasnego roku, nowych sukcesów i chwil, do których chce się wracać.</p>
<p style="margin:0 0 14px">A żeby święto było jeszcze radośniejsze — dajemy <strong style="color:#d97706">−30% na dowolny zabieg</strong>. Promocja działa cały tydzień od Twoich urodzin.</p>
<p style="margin:0;color:#7a8294;font-size:13px">Po prostu zapisz się i powiedz administratorowi przy wizycie.</p>`,
      ctaLabel: 'Odbierz prezent',
      signature: 'Z miłością, zespół {salon} ❤️',
    }),
  },
  {
    id: 'winback',
    label: 'Wróć do nas',
    emoji: '💌',
    sms: '{firstName}, dawno się nie widzieliśmy! {salon} tęskni. Wróć na manicure — mamy nowe kolory sezonu 💅',
    subject: '{firstName}, tęsknimy 💌',
    bodyHtml: emailCard({
      accentBg: '#e0f2fe',
      accentText: '#0c4a6e',
      emoji: '💌',
      heading: '{firstName}, dawno się nie widzieliśmy',
      body: `<p style="margin:0 0 14px">Chcemy przypomnieć o sobie i zaprosić Cię z powrotem. W tym czasie:</p>
<ul style="margin:0 0 14px;padding-left:24px;line-height:1.8">
  <li>📌 Odświeżyliśmy kolekcję kolorów sezonu</li>
  <li>📌 Zaktualizowaliśmy menu zabiegów</li>
  <li>📌 Do zespołu dołączyli nowi mistrzowie</li>
</ul>
<p style="margin:0 0 14px">Wróć — a my zadbamy, by wizyta była wyjątkowa.</p>`,
      ctaLabel: 'Zapisz się teraz',
      signature: 'Do zobaczenia, {salon}',
    }),
  },
  {
    id: 'new_service',
    label: 'Nowa usługa',
    emoji: '✨',
    sms: '{firstName}, w {salon} nowa usługa! Zapisz się i wypróbuj jako pierwsza po specjalnej cenie.',
    subject: 'Nowość w {salon} — {firstName}, sprawdź ✨',
    bodyHtml: emailCard({
      accentBg: '#ede9fe',
      accentText: '#5b21b6',
      emoji: '✨',
      heading: 'Poznaj nowość',
      body: `<p style="margin:0 0 14px">Cześć, <strong>{firstName}</strong>!</p>
<p style="margin:0 0 14px">Rozszerzyliśmy menu — mamy nowy zabieg, który gorąco polecamy wypróbować.</p>
<p style="margin:0 0 14px">Dla wszystkich klientek, które zapiszą się w ciągu 7 dni — <strong style="color:#d97706">specjalna cena startowa</strong>.</p>`,
      ctaLabel: 'Zapisz się pierwsza',
      signature: '{salon} · {date}',
    }),
  },
  {
    id: 'seasonal',
    label: 'Sezonowa wyprzedaż',
    emoji: '🍂',
    sms: '{firstName}, sezonowa wyprzedaż w {salon}! Rabaty do 35% na top-usługi — tylko ten tydzień.',
    subject: 'Sezonowa wyprzedaż: do −35% — {firstName}, zdąż 🍂',
    bodyHtml: emailCard({
      accentBg: '#fed7aa',
      accentText: '#7c2d12',
      emoji: '🍂',
      heading: 'Sezonowa wyprzedaż',
      body: `<p style="margin:0 0 14px">Cześć, <strong>{firstName}</strong>! Przygotowujemy się do nowego sezonu razem. W tym tygodniu rabaty na top-zabiegi — <strong style="color:#c2410c">do −35%</strong>.</p>
<table style="width:100%;margin:0 0 14px;border-collapse:collapse">
  <tr><td style="padding:8px 0;border-bottom:1px solid #fed7aa">Manicure + pedicure w komplecie</td><td style="padding:8px 0;border-bottom:1px solid #fed7aa;text-align:right;font-weight:700;color:#c2410c">−25%</td></tr>
  <tr><td style="padding:8px 0;border-bottom:1px solid #fed7aa">Hybryda</td><td style="padding:8px 0;border-bottom:1px solid #fed7aa;text-align:right;font-weight:700;color:#c2410c">−20%</td></tr>
  <tr><td style="padding:8px 0">Henna brwi</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#c2410c">−35%</td></tr>
</table>`,
      ctaLabel: 'Zapisz się teraz',
      signature: 'Tylko do końca tygodnia · {salon}',
    }),
  },
  {
    id: 'holiday',
    label: 'Promocja świąteczna',
    emoji: '🎁',
    sms: '{firstName}, święta się zbliżają 🎁 {salon}: zapisz się z wyprzedzeniem — najlepsze sloty znikają pierwsze.',
    subject: 'Świąteczne sloty się kończą — {firstName}, zdąż 🎁',
    bodyHtml: emailCard({
      accentBg: '#fee2e2',
      accentText: '#991b1b',
      emoji: '🎁',
      heading: 'Święta się zbliżają',
      body: `<p style="margin:0 0 14px">Cześć, <strong>{firstName}</strong>!</p>
<p style="margin:0 0 14px">Najlepsze sloty znikają pierwsze, a przed świętami ruch klientek jest zawsze duży. Zapisz się z wyprzedzeniem, żeby dostać ulubioną godzinę.</p>
<p style="margin:0 0 14px">A dla tych kto zapisze się w tym tygodniu — <strong style="color:#dc2626">bonusowy zabieg w prezencie</strong> 🎁</p>`,
      ctaLabel: 'Zapisz się na święta',
      signature: '{salon} czeka na Ciebie',
    }),
  },
]

const TEMPLATES_EN: BroadcastTemplate[] = [
  {
    id: 'promo20',
    label: '−20% promo',
    emoji: '💸',
    sms: '{salon}: {firstName}, −20% off manicure all week! Reply or tap the link to book.',
    subject: '{firstName}, −20% off manicure — through Sunday 💸',
    bodyHtml: emailCard({
      accentBg: '#fef3c7',
      accentText: '#1a2540',
      emoji: '💸',
      heading: 'Promo week',
      body: `<p style="margin:0 0 14px">Hi, <strong>{firstName}</strong>!</p>
<p style="margin:0 0 14px">It's promo week — we're running <strong style="color:#d97706">−20% off classic and gel manicure</strong>.</p>
<p style="margin:0 0 14px">Perfect time to refresh your nails before the weekend ✨</p>`,
      ctaLabel: 'Book a manicure',
      signature: 'Thanks for choosing {salon} ❤️',
    }),
  },
  {
    id: 'birthday',
    label: 'Birthday',
    emoji: '🎂',
    sms: '{firstName}, happy birthday from {salon}! 🎉 −30% off any service this week — your gift is waiting.',
    subject: '{firstName}, happy birthday! Your gift inside 🎁',
    bodyHtml: emailCard({
      accentBg: '#fce7f3',
      accentText: '#9d174d',
      emoji: '🎂',
      heading: 'Happy birthday, {firstName}!',
      body: `<p style="margin:0 0 14px">Wishing you a bright year, new wins and moments you'll want to relive.</p>
<p style="margin:0 0 14px">To make the celebration brighter — we're gifting <strong style="color:#d97706">−30% on any treatment</strong>. Valid for the full week from your birthday.</p>
<p style="margin:0;color:#7a8294;font-size:13px">Just book and mention it at the visit.</p>`,
      ctaLabel: 'Claim your gift',
      signature: 'With love, the {salon} team ❤️',
    }),
  },
  {
    id: 'winback',
    label: 'Win-back',
    emoji: '💌',
    sms: '{firstName}, long time no see! {salon} misses you. Come back for a manicure — new seasonal colors are in 💅',
    subject: '{firstName}, we miss you 💌',
    bodyHtml: emailCard({
      accentBg: '#e0f2fe',
      accentText: '#0c4a6e',
      emoji: '💌',
      heading: '{firstName}, long time no see',
      body: `<p style="margin:0 0 14px">A friendly reminder. While you've been away:</p>
<ul style="margin:0 0 14px;padding-left:24px;line-height:1.8">
  <li>📌 New seasonal color palette</li>
  <li>📌 Updated treatment menu</li>
  <li>📌 A couple of new masters on the team</li>
</ul>
<p style="margin:0 0 14px">Come back, and we'll make your visit special.</p>`,
      ctaLabel: 'Book now',
      signature: 'See you soon, {salon}',
    }),
  },
  {
    id: 'new_service',
    label: 'New service',
    emoji: '✨',
    sms: '{firstName}, new service at {salon}! Tap the link to be the first to try at intro pricing.',
    subject: 'New at {salon} — {firstName}, check it out ✨',
    bodyHtml: emailCard({
      accentBg: '#ede9fe',
      accentText: '#5b21b6',
      emoji: '✨',
      heading: 'Meet the new',
      body: `<p style="margin:0 0 14px">Hi, <strong>{firstName}</strong>!</p>
<p style="margin:0 0 14px">We've expanded our menu — there's a new treatment we strongly recommend trying.</p>
<p style="margin:0 0 14px">Anyone who books within the next 7 days gets a <strong style="color:#d97706">special intro price</strong>.</p>`,
      ctaLabel: 'Be the first',
      signature: '{salon} · {date}',
    }),
  },
  {
    id: 'seasonal',
    label: 'Seasonal sale',
    emoji: '🍂',
    sms: '{firstName}, seasonal sale at {salon}! Up to 35% off top services — this week only.',
    subject: 'Seasonal sale: up to −35% — {firstName}, hurry 🍂',
    bodyHtml: emailCard({
      accentBg: '#fed7aa',
      accentText: '#7c2d12',
      emoji: '🍂',
      heading: 'Seasonal sale',
      body: `<p style="margin:0 0 14px">Hi, <strong>{firstName}</strong>! Getting ready for the new season together. This week — top treatments <strong style="color:#c2410c">up to −35%</strong>.</p>
<table style="width:100%;margin:0 0 14px;border-collapse:collapse">
  <tr><td style="padding:8px 0;border-bottom:1px solid #fed7aa">Manicure + pedicure combo</td><td style="padding:8px 0;border-bottom:1px solid #fed7aa;text-align:right;font-weight:700;color:#c2410c">−25%</td></tr>
  <tr><td style="padding:8px 0;border-bottom:1px solid #fed7aa">Gel polish</td><td style="padding:8px 0;border-bottom:1px solid #fed7aa;text-align:right;font-weight:700;color:#c2410c">−20%</td></tr>
  <tr><td style="padding:8px 0">Brow tinting</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#c2410c">−35%</td></tr>
</table>`,
      ctaLabel: 'Book now',
      signature: 'Until end of week · {salon}',
    }),
  },
  {
    id: 'holiday',
    label: 'Holiday promo',
    emoji: '🎁',
    sms: '{firstName}, holidays are coming 🎁 {salon}: book early — best slots go first.',
    subject: 'Holiday slots filling up — {firstName}, hurry 🎁',
    bodyHtml: emailCard({
      accentBg: '#fee2e2',
      accentText: '#991b1b',
      emoji: '🎁',
      heading: 'Holidays are coming',
      body: `<p style="margin:0 0 14px">Hi, <strong>{firstName}</strong>!</p>
<p style="margin:0 0 14px">Best slots go first, and pre-holiday traffic is heavy. Book early to get your favorite time.</p>
<p style="margin:0 0 14px">Anyone who books this week — <strong style="color:#dc2626">bonus treatment as a gift</strong> 🎁</p>`,
      ctaLabel: 'Book for the holidays',
      signature: '{salon} is waiting for you',
    }),
  },
]

export function getBroadcastTemplates(locale: string): BroadcastTemplate[] {
  const base = locale.split('-')[0]?.toLowerCase()
  if (base === 'pl') return TEMPLATES_PL
  if (base === 'en') return TEMPLATES_EN
  return TEMPLATES_RU
}
