/**
 * Готовые шаблоны для рассылок. Кнопка в UI клик-заполняет SMS + email subject +
 * email body одним нажатием. Юзер потом редактирует под себя.
 *
 * Все HTML-тела для email — простые inline-стили, чтобы Gmail / Outlook их
 * корректно отрендерили (CSS в <style> часть писем выкидывают).
 *
 * 3 локали: RU / EN / PL. Возвращаем шаблоны на текущей локали юзера —
 * клиенты Polish-рынка должны получать письма на польском.
 */

export type BroadcastTemplate = {
  id: string
  label: string
  emoji: string
  sms: string
  subject: string
  bodyHtml: string
}

const TEMPLATES_RU: BroadcastTemplate[] = [
  {
    id: 'promo20',
    label: 'Акция −20%',
    emoji: '💸',
    sms: '{salon}: −20% на маникюр всю эту неделю! Запишись в ответ или по ссылке.',
    subject: '−20% на маникюр — только до воскресенья 💸',
    bodyHtml: `<h2 style="color:#1a2540;margin:0 0 12px">Привет!</h2>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px">У нас неделя выгодных предложений — всё это время мы делаем <strong>−20% на классический и гель-маникюр</strong>.</p>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px">Время идеальное чтобы освежить руки перед выходными.</p>
<p style="font-size:16px;line-height:1.6;margin:0 0 24px"><a href="#" style="background:#1a2540;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Записаться на маникюр</a></p>
<p style="color:#888;font-size:13px;margin:0">Спасибо, что выбираете нас ❤️</p>`,
  },
  {
    id: 'birthday',
    label: 'День рождения',
    emoji: '🎂',
    sms: '{salon}: с Днём рождения! 🎉 Дарим −30% на любую услугу в эту неделю — подари себе праздник.',
    subject: 'С Днём рождения! Наш подарок — внутри 🎁',
    bodyHtml: `<h2 style="color:#1a2540;margin:0 0 12px">С Днём рождения! 🎂</h2>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px">Желаем тебе яркого года, новых побед и моментов которые хочется повторить.</p>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px">А чтобы праздник был ещё ярче — дарим <strong>−30% на любую процедуру</strong>. Промо действует всю неделю с твоего дня рождения.</p>
<p style="font-size:16px;line-height:1.6;margin:0 0 24px"><a href="#" style="background:#d96b6b;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Записаться на подарок</a></p>
<p style="color:#888;font-size:13px;margin:0">С любовью, твой салон ❤️</p>`,
  },
  {
    id: 'winback',
    label: 'Возвращайся',
    emoji: '💌',
    sms: '{salon}: давно не виделись! Скучаем. Возвращайся на маникюр — у нас новые цвета сезона.',
    subject: 'Мы скучаем 💌',
    bodyHtml: `<h2 style="color:#1a2540;margin:0 0 12px">Давно не виделись 👋</h2>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px">Хотим напомнить о себе и предложить вернуться — у нас новая коллекция цветов сезона, обновлённый прайс и пара новых мастеров.</p>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px">Возвращайся, и мы сделаем визит особенным.</p>
<p style="font-size:16px;line-height:1.6;margin:0 0 24px"><a href="#" style="background:#1a2540;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Записаться сейчас</a></p>`,
  },
  {
    id: 'new_service',
    label: 'Новая услуга',
    emoji: '✨',
    sms: '{salon}: новая услуга в каталоге! Запишись по ссылке и попробуй первой.',
    subject: 'Новинка в нашем каталоге ✨',
    bodyHtml: `<h2 style="color:#1a2540;margin:0 0 12px">Встречай новинку ✨</h2>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px">Мы расширили меню — теперь у нас новая процедура которую мы очень советуем попробовать.</p>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px">Для всех клиентов кто запишется в течение 7 дней — <strong>специальная стартовая цена</strong>.</p>
<p style="font-size:16px;line-height:1.6;margin:0 0 24px"><a href="#" style="background:#1a2540;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Записаться первой</a></p>`,
  },
  {
    id: 'seasonal',
    label: 'Сезонная распродажа',
    emoji: '🍂',
    sms: '{salon}: сезонная распродажа! Скидки до 35% на топ-услуги — только эту неделю.',
    subject: 'Сезонная распродажа: до −35%',
    bodyHtml: `<h2 style="color:#1a2540;margin:0 0 12px">Сезонная распродажа 🍂</h2>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px">Готовимся к новому сезону вместе. На этой неделе скидки на топовые процедуры — <strong>до −35%</strong>.</p>
<ul style="font-size:16px;line-height:1.7;margin:0 0 16px;padding-left:20px">
<li>Маникюр + педикюр в комплексе — −25%</li>
<li>Покрытие гель-лаком — −20%</li>
<li>Окрашивание бровей — −35%</li>
</ul>
<p style="font-size:16px;line-height:1.6;margin:0 0 24px"><a href="#" style="background:#d96b6b;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Записаться сейчас</a></p>`,
  },
  {
    id: 'holiday',
    label: 'Праздничная акция',
    emoji: '🎁',
    sms: '{salon}: праздник близко 🎁 Запишись заранее — лучшие слоты разбирают первыми.',
    subject: 'Праздничные слоты заканчиваются 🎁',
    bodyHtml: `<h2 style="color:#1a2540;margin:0 0 12px">Праздник близко 🎁</h2>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px">Хорошие слоты разбирают первыми — а перед праздниками поток клиентов всегда плотный. Запишись заранее, чтобы получить любимое время.</p>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px">А для тех кто запишется на этой неделе — <strong>бонусная процедура в подарок</strong>.</p>
<p style="font-size:16px;line-height:1.6;margin:0 0 24px"><a href="#" style="background:#1a2540;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Записаться к празднику</a></p>`,
  },
]

const TEMPLATES_PL: BroadcastTemplate[] = [
  {
    id: 'promo20',
    label: 'Promocja −20%',
    emoji: '💸',
    sms: '{salon}: −20% na manicure przez cały tydzień! Zapisz się w odpowiedzi lub po linku.',
    subject: '−20% na manicure — tylko do niedzieli 💸',
    bodyHtml: `<h2 style="color:#1a2540;margin:0 0 12px">Cześć!</h2>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px">Mamy tydzień atrakcyjnych ofert — przez cały ten czas robimy <strong>−20% na manicure klasyczny i hybrydowy</strong>.</p>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px">Idealny moment, żeby odświeżyć paznokcie przed weekendem.</p>
<p style="font-size:16px;line-height:1.6;margin:0 0 24px"><a href="#" style="background:#1a2540;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Zapisz się na manicure</a></p>
<p style="color:#888;font-size:13px;margin:0">Dziękujemy, że nas wybierasz ❤️</p>`,
  },
  {
    id: 'birthday',
    label: 'Urodziny',
    emoji: '🎂',
    sms: '{salon}: Wszystkiego najlepszego! 🎉 −30% na dowolną usługę przez cały tydzień — sprezentuj sobie chwilę.',
    subject: 'Wszystkiego najlepszego! Twój prezent w środku 🎁',
    bodyHtml: `<h2 style="color:#1a2540;margin:0 0 12px">Wszystkiego najlepszego! 🎂</h2>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px">Życzymy jasnego roku, nowych sukcesów i chwil, do których chce się wracać.</p>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px">A żeby święto było jeszcze radośniejsze — dajemy <strong>−30% na dowolny zabieg</strong>. Promocja działa przez cały tydzień od Twoich urodzin.</p>
<p style="font-size:16px;line-height:1.6;margin:0 0 24px"><a href="#" style="background:#d96b6b;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Odbierz prezent</a></p>
<p style="color:#888;font-size:13px;margin:0">Z miłością, Twój salon ❤️</p>`,
  },
  {
    id: 'winback',
    label: 'Wróć do nas',
    emoji: '💌',
    sms: '{salon}: dawno się nie widzieliśmy! Tęsknimy. Wróć na manicure — mamy nowe kolory sezonu.',
    subject: 'Tęsknimy 💌',
    bodyHtml: `<h2 style="color:#1a2540;margin:0 0 12px">Dawno się nie widzieliśmy 👋</h2>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px">Chcemy przypomnieć o sobie i zaprosić Cię z powrotem — mamy nową kolekcję kolorów sezonu, zaktualizowany cennik i kilku nowych mistrzów.</p>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px">Wróć, a my zadbamy, by wizyta była wyjątkowa.</p>
<p style="font-size:16px;line-height:1.6;margin:0 0 24px"><a href="#" style="background:#1a2540;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Zapisz się teraz</a></p>`,
  },
  {
    id: 'new_service',
    label: 'Nowa usługa',
    emoji: '✨',
    sms: '{salon}: nowa usługa w katalogu! Zapisz się po linku i wypróbuj jako pierwsza.',
    subject: 'Nowość w naszym katalogu ✨',
    bodyHtml: `<h2 style="color:#1a2540;margin:0 0 12px">Poznaj nowość ✨</h2>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px">Rozszerzyliśmy menu — mamy nowy zabieg, który gorąco polecamy wypróbować.</p>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px">Dla wszystkich klientek, które zapiszą się w ciągu 7 dni — <strong>specjalna cena startowa</strong>.</p>
<p style="font-size:16px;line-height:1.6;margin:0 0 24px"><a href="#" style="background:#1a2540;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Zapisz się pierwsza</a></p>`,
  },
  {
    id: 'seasonal',
    label: 'Sezonowa wyprzedaż',
    emoji: '🍂',
    sms: '{salon}: sezonowa wyprzedaż! Rabaty do 35% na top-usługi — tylko ten tydzień.',
    subject: 'Sezonowa wyprzedaż: do −35%',
    bodyHtml: `<h2 style="color:#1a2540;margin:0 0 12px">Sezonowa wyprzedaż 🍂</h2>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px">Przygotowujemy się do nowego sezonu razem. W tym tygodniu rabaty na top-zabiegi — <strong>do −35%</strong>.</p>
<ul style="font-size:16px;line-height:1.7;margin:0 0 16px;padding-left:20px">
<li>Manicure + pedicure w komplecie — −25%</li>
<li>Hybryda — −20%</li>
<li>Henna brwi — −35%</li>
</ul>
<p style="font-size:16px;line-height:1.6;margin:0 0 24px"><a href="#" style="background:#d96b6b;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Zapisz się teraz</a></p>`,
  },
  {
    id: 'holiday',
    label: 'Promocja świąteczna',
    emoji: '🎁',
    sms: '{salon}: święta się zbliżają 🎁 Zapisz się z wyprzedzeniem — najlepsze sloty znikają pierwsze.',
    subject: 'Świąteczne sloty się kończą 🎁',
    bodyHtml: `<h2 style="color:#1a2540;margin:0 0 12px">Święta się zbliżają 🎁</h2>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px">Najlepsze sloty znikają pierwsze — a przed świętami ruch klientek jest zawsze duży. Zapisz się z wyprzedzeniem, żeby dostać ulubioną godzinę.</p>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px">A dla tych, które zapiszą się w tym tygodniu — <strong>bonusowy zabieg w prezencie</strong>.</p>
<p style="font-size:16px;line-height:1.6;margin:0 0 24px"><a href="#" style="background:#1a2540;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Zapisz się na święta</a></p>`,
  },
]

const TEMPLATES_EN: BroadcastTemplate[] = [
  {
    id: 'promo20',
    label: '−20% promo',
    emoji: '💸',
    sms: '{salon}: −20% off manicure all week! Reply or tap the link to book.',
    subject: '−20% off manicure — through Sunday 💸',
    bodyHtml: `<h2 style="color:#1a2540;margin:0 0 12px">Hi!</h2>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px">It's promo week — we're running <strong>−20% off classic and gel manicure</strong>.</p>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px">Perfect time to refresh your nails before the weekend.</p>
<p style="font-size:16px;line-height:1.6;margin:0 0 24px"><a href="#" style="background:#1a2540;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Book a manicure</a></p>
<p style="color:#888;font-size:13px;margin:0">Thanks for choosing us ❤️</p>`,
  },
  {
    id: 'birthday',
    label: 'Birthday',
    emoji: '🎂',
    sms: '{salon}: Happy birthday! 🎉 We are gifting −30% on any service this week — treat yourself.',
    subject: 'Happy birthday! Your gift inside 🎁',
    bodyHtml: `<h2 style="color:#1a2540;margin:0 0 12px">Happy birthday! 🎂</h2>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px">Wishing you a bright year, new wins and moments you'll want to relive.</p>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px">To make the celebration brighter — we are gifting <strong>−30% on any treatment</strong>. Valid for the full week from your birthday.</p>
<p style="font-size:16px;line-height:1.6;margin:0 0 24px"><a href="#" style="background:#d96b6b;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Claim your gift</a></p>
<p style="color:#888;font-size:13px;margin:0">Love, your salon ❤️</p>`,
  },
  {
    id: 'winback',
    label: 'Win-back',
    emoji: '💌',
    sms: '{salon}: long time no see! We miss you. Come back for a manicure — new seasonal colors are in.',
    subject: 'We miss you 💌',
    bodyHtml: `<h2 style="color:#1a2540;margin:0 0 12px">Long time no see 👋</h2>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px">Just a friendly reminder — we have a fresh seasonal palette, updated menu, and a couple of new masters.</p>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px">Come back, and we'll make your visit special.</p>
<p style="font-size:16px;line-height:1.6;margin:0 0 24px"><a href="#" style="background:#1a2540;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Book now</a></p>`,
  },
  {
    id: 'new_service',
    label: 'New service',
    emoji: '✨',
    sms: '{salon}: new service in our menu! Tap the link to be the first to try.',
    subject: 'New addition to our menu ✨',
    bodyHtml: `<h2 style="color:#1a2540;margin:0 0 12px">Meet the new ✨</h2>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px">We've expanded our menu — there's a new treatment we strongly recommend trying.</p>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px">Anyone who books within the next 7 days gets a <strong>special intro price</strong>.</p>
<p style="font-size:16px;line-height:1.6;margin:0 0 24px"><a href="#" style="background:#1a2540;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Be the first</a></p>`,
  },
  {
    id: 'seasonal',
    label: 'Seasonal sale',
    emoji: '🍂',
    sms: '{salon}: seasonal sale! Up to 35% off top services — this week only.',
    subject: 'Seasonal sale: up to −35%',
    bodyHtml: `<h2 style="color:#1a2540;margin:0 0 12px">Seasonal sale 🍂</h2>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px">Getting ready for the new season together. This week — discounts on top treatments <strong>up to −35%</strong>.</p>
<ul style="font-size:16px;line-height:1.7;margin:0 0 16px;padding-left:20px">
<li>Manicure + pedicure combo — −25%</li>
<li>Gel polish — −20%</li>
<li>Brow tinting — −35%</li>
</ul>
<p style="font-size:16px;line-height:1.6;margin:0 0 24px"><a href="#" style="background:#d96b6b;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Book now</a></p>`,
  },
  {
    id: 'holiday',
    label: 'Holiday promo',
    emoji: '🎁',
    sms: '{salon}: holidays are coming 🎁 Book early — best slots go first.',
    subject: 'Holiday slots filling up 🎁',
    bodyHtml: `<h2 style="color:#1a2540;margin:0 0 12px">Holidays are coming 🎁</h2>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px">Best slots go first — and pre-holiday traffic is always heavy. Book early to get your favorite time.</p>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px">Anyone who books this week — <strong>bonus treatment as a gift</strong>.</p>
<p style="font-size:16px;line-height:1.6;margin:0 0 24px"><a href="#" style="background:#1a2540;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Book for the holidays</a></p>`,
  },
]

export function getBroadcastTemplates(locale: string): BroadcastTemplate[] {
  const base = locale.split('-')[0]?.toLowerCase()
  if (base === 'pl') return TEMPLATES_PL
  if (base === 'en') return TEMPLATES_EN
  return TEMPLATES_RU
}
