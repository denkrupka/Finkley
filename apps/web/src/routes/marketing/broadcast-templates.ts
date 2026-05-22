/**
 * Готовые шаблоны для рассылок. Кнопка в UI клик-заполняет SMS + email subject +
 * email body одним нажатием. Юзер потом редактирует под себя.
 *
 * Каждый шаблон возвращает поля по локали — мы сейчас держим RU как основной.
 * Если позже понадобится PL/EN — добавить ветки в getter.
 *
 * Все HTML-тела для email — простые inline-стили, чтобы Gmail / Outlook их
 * корректно отрендерили (CSS в <style> часть писем выкидывают).
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

export function getBroadcastTemplates(): BroadcastTemplate[] {
  return TEMPLATES_RU
}
