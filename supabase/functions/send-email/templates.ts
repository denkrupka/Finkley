/**
 * Inline-копии HTML-шаблонов писем (источник в docs/email-templates/*.html).
 *
 * Edge Functions Supabase бандлят импорты на деплое, и читать .html-файлы
 * с диска не вариант — поэтому держим тут как строки. Когда меняешь дизайн,
 * правишь docs/email-templates/<alias>.html и синхронизируешь сюда (без
 * комментариев Postmark в начале).
 *
 * Subject-строки тут же — Resend требует их на каждый /emails вызов.
 */

export type TemplateAlias =
  | 'welcome'
  | 'trial_ending'
  | 'payment_succeeded'
  | 'payment_failed'
  | 'subscription_canceled'
  | 'gdpr_export'
  | 'weekly_digest'
  | 'team_invitation'
  | 'bank_consent_expiring'

export type EmailTemplate = {
  subject: string
  html: string
}

export const TEMPLATES: Record<TemplateAlias, EmailTemplate> = {
  welcome: {
    subject: 'Привет от Finkley 👋',
    html: `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Добро пожаловать в Finkley</title>
</head>
<body style="margin:0; padding:0; background:#f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#0f172a;">

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f8fafc; padding: 40px 20px;">
<tr><td align="center">

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="background:#ffffff; border-radius:8px; padding:40px;">
<tr><td>

{{logo_block}}

<h1 style="margin:0 0 16px 0; font-size:24px; line-height:32px; color:#0f172a;">
Привет, {{full_name}}!
</h1>

<p style="margin:0 0 16px 0; font-size:16px; line-height:24px; color:#334155;">
Спасибо, что присоединился к Finkley. Я рад, что ты с нами.
</p>

<p style="margin:0 0 16px 0; font-size:16px; line-height:24px; color:#334155;">
Finkley поможет тебе видеть реальную прибыль твоего салона <strong>{{salon_name}}</strong> — после всех расходов, без таблиц и калькулятора.
</p>

<p style="margin:0 0 24px 0; font-size:16px; line-height:24px; color:#334155;">
Чтобы начать, добавь свой первый визит. Это займёт меньше минуты:
</p>

<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center" style="background:#0f172a; border-radius:6px; padding:14px 32px;">
<a href="{{app_url}}" style="color:#ffffff; text-decoration:none; font-weight:600; font-size:16px;">
Открыть Finkley
</a>
</td></tr>
</table>

<p style="margin:32px 0 16px 0; font-size:16px; line-height:24px; color:#334155;">
У тебя есть <strong>14 дней бесплатного пробного периода</strong>. Без карты, без подвохов. Если что-то не понравится — просто не оплачивай.
</p>

<p style="margin:0 0 16px 0; font-size:16px; line-height:24px; color:#334155;">
Если будут вопросы или что-то будет работать не так — пиши мне напрямую на <a href="mailto:info@finkley.app" style="color:#10b981; text-decoration:none;">info@finkley.app</a>. Отвечаю лично.
</p>

<p style="margin:0; font-size:16px; line-height:24px; color:#334155;">
{{owner_name}}<br>
<span style="color:#64748b; font-size:14px;">Создатель Finkley</span>
</p>

</td></tr>
</table>

<p style="margin:24px 0 0 0; font-size:12px; line-height:18px; color:#94a3b8; text-align:center;">
Finkley · &lt;юр.лицо&gt;, &lt;адрес&gt;, Польша<br>
Это транзакционное письмо. Если у тебя есть вопросы по обработке данных — info@finkley.app
</p>

</td></tr>
</table>

</body>
</html>`,
  },

  trial_ending: {
    subject: 'Твой пробный период заканчивается через {{days_left}} дня',
    html: `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Пробный период заканчивается</title>
</head>
<body style="margin:0; padding:0; background:#f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#0f172a;">

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f8fafc; padding: 40px 20px;">
<tr><td align="center">

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="background:#ffffff; border-radius:8px; padding:40px;">
<tr><td>

<h1 style="margin:0 0 16px 0; font-size:24px; line-height:32px; color:#0f172a;">
Привет, {{full_name}}.
</h1>

<p style="margin:0 0 16px 0; font-size:16px; line-height:24px; color:#334155;">
Твой пробный период в Finkley заканчивается через <strong>{{days_left}} дня</strong>.
</p>

<p style="margin:0 0 24px 0; font-size:16px; line-height:24px; color:#334155;">
За это время ты внесла <strong>{{visits_during_trial}}</strong> визитов на сумму <strong>{{revenue_during_trial}}</strong>. Хорошее начало.
</p>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f1f5f9; border-radius:6px; padding:20px; margin-bottom:24px;">
<tr><td>
<p style="margin:0 0 8px 0; font-size:14px; color:#64748b;">Тариф Finkley Standard</p>
<p style="margin:0 0 4px 0; font-size:24px; font-weight:600; color:#0f172a;">€15 / месяц</p>
<p style="margin:0; font-size:14px; color:#64748b;">VAT добавляется автоматически в зависимости от твоей страны</p>
</td></tr>
</table>

<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center" style="background:#0f172a; border-radius:6px; padding:14px 32px;">
<a href="{{billing_url}}" style="color:#ffffff; text-decoration:none; font-weight:600; font-size:16px;">
Оформить подписку
</a>
</td></tr>
</table>

<p style="margin:32px 0 16px 0; font-size:14px; line-height:22px; color:#64748b;">
Оплата по карте через Stripe — безопасно. Money-back guarantee 7 дней — если передумаешь, вернём деньги.
</p>

<p style="margin:0 0 16px 0; font-size:14px; line-height:22px; color:#64748b;">
Если решишь не продолжать — твои данные сохранятся 30 дней, потом удалятся. До этого срока ты можешь экспортировать всё в CSV.
</p>

<p style="margin:24px 0 0 0; font-size:16px; line-height:24px; color:#334155;">
{{owner_name}}<br>
<span style="color:#64748b; font-size:14px;">info@finkley.app</span>
</p>

</td></tr>
</table>

<p style="margin:24px 0 0 0; font-size:12px; line-height:18px; color:#94a3b8; text-align:center;">
Finkley · &lt;юр.лицо&gt;, &lt;адрес&gt;, Польша
</p>

</td></tr>
</table>

</body>
</html>`,
  },

  payment_succeeded: {
    subject: 'Спасибо за оплату · Finkley',
    html: `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Оплата прошла</title>
</head>
<body style="margin:0; padding:0; background:#f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#0f172a;">

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f8fafc; padding: 40px 20px;">
<tr><td align="center">

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="background:#ffffff; border-radius:8px; padding:40px;">
<tr><td>

<h1 style="margin:0 0 16px 0; font-size:24px; line-height:32px; color:#0f172a;">
Спасибо, {{full_name}}!
</h1>

<p style="margin:0 0 24px 0; font-size:16px; line-height:24px; color:#334155;">
Оплата прошла успешно. Finkley работает на полную мощность.
</p>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#ecfdf5; border-radius:6px; padding:20px; margin-bottom:24px;">
<tr><td>
<p style="margin:0 0 4px 0; font-size:14px; color:#047857;">Оплачено</p>
<p style="margin:0 0 8px 0; font-size:24px; font-weight:600; color:#065f46;">{{amount}}</p>
<p style="margin:0; font-size:14px; color:#065f46;">Следующее списание: {{period_end_date}}</p>
</td></tr>
</table>

<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr><td style="background:#f1f5f9; border-radius:6px; padding:12px 24px;">
<a href="{{invoice_url}}" style="color:#0f172a; text-decoration:none; font-weight:500; font-size:14px;">
📄 Скачать фактуру
</a>
</td></tr>
</table>

<p style="margin:32px 0 16px 0; font-size:14px; line-height:22px; color:#64748b;">
Управлять подпиской, сменить карту или отменить можно в разделе Billing внутри приложения.
</p>

<p style="margin:24px 0 0 0; font-size:16px; line-height:24px; color:#334155;">
{{owner_name}}
</p>

</td></tr>
</table>

<p style="margin:24px 0 0 0; font-size:12px; line-height:18px; color:#94a3b8; text-align:center;">
Finkley · &lt;юр.лицо&gt;, &lt;адрес&gt;, Польша
</p>

</td></tr>
</table>

</body>
</html>`,
  },

  payment_failed: {
    subject: 'Не получилось списать оплату · Finkley',
    html: `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Не получилось списать оплату</title>
</head>
<body style="margin:0; padding:0; background:#f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#0f172a;">

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f8fafc; padding: 40px 20px;">
<tr><td align="center">

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="background:#ffffff; border-radius:8px; padding:40px;">
<tr><td>

<h1 style="margin:0 0 16px 0; font-size:24px; line-height:32px; color:#0f172a;">
Привет, {{full_name}}.
</h1>

<p style="margin:0 0 16px 0; font-size:16px; line-height:24px; color:#334155;">
Мы попытались списать <strong>{{amount}}</strong> за подписку Finkley, но оплата не прошла.
</p>

<p style="margin:0 0 24px 0; font-size:16px; line-height:24px; color:#334155;">
Это могло быть из-за: недостатка средств, истёкшего срока карты, или 3D-Secure подтверждения. Stripe попробует снова <strong>{{retry_date}}</strong>.
</p>

<p style="margin:0 0 24px 0; font-size:16px; line-height:24px; color:#334155;">
Чтобы не потерять доступ — обнови карту или подтверди оплату:
</p>

<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center" style="background:#0f172a; border-radius:6px; padding:14px 32px;">
<a href="{{billing_url}}" style="color:#ffffff; text-decoration:none; font-weight:600; font-size:16px;">
Управление подпиской
</a>
</td></tr>
</table>

<p style="margin:32px 0 16px 0; font-size:14px; line-height:22px; color:#64748b;">
Доступ к Finkley сохраняется ещё несколько дней. Если оплата не пройдёт после нескольких попыток — мы переведём аккаунт в режим "только чтение", но данные сохранятся.
</p>

<p style="margin:0 0 16px 0; font-size:14px; line-height:22px; color:#64748b;">
Вопросы — пиши на <a href="mailto:info@finkley.app" style="color:#10b981; text-decoration:none;">info@finkley.app</a>.
</p>

<p style="margin:24px 0 0 0; font-size:16px; line-height:24px; color:#334155;">
{{owner_name}}
</p>

</td></tr>
</table>

<p style="margin:24px 0 0 0; font-size:12px; line-height:18px; color:#94a3b8; text-align:center;">
Finkley · &lt;юр.лицо&gt;, &lt;адрес&gt;, Польша
</p>

</td></tr>
</table>

</body>
</html>`,
  },

  gdpr_export: {
    subject: 'Твой архив данных Finkley готов',
    html: `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Архив данных Finkley</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
<div style="max-width:600px;margin:0 auto;padding:40px 20px;">
<div style="background:#ffffff;border-radius:8px;padding:40px;">
<p style="margin:0 0 24px 0;font-size:14px;font-weight:700;letter-spacing:0.05em;color:#1A1A2E;">FINKLEY</p>
<h1 style="margin:0 0 16px 0;font-size:22px;line-height:30px;color:#0f172a;">Архив готов</h1>
<p style="margin:0 0 16px 0;font-size:16px;line-height:24px;color:#334155;">
Привет, {{full_name}}. Мы собрали все твои данные в Finkley в один ZIP-архив.
</p>
<p style="margin:0 0 24px 0;font-size:16px;line-height:24px;color:#334155;">
Ссылка действительна 24 часа. После — нужно будет запросить новый экспорт.
</p>
<p style="margin:0 0 24px 0;">
<a href="{{download_url}}" style="display:inline-block;background:#1A1A2E;color:#ffffff;padding:14px 32px;text-decoration:none;border-radius:6px;font-weight:600;font-size:16px;">Скачать архив</a>
</p>
<p style="margin:24px 0 16px 0;font-size:14px;line-height:22px;color:#64748b;">
Внутри — CSV с твоими визитами, расходами, клиентами, мастерами, услугами и категориями. README.txt объясняет каждую колонку.
</p>
<p style="margin:0 0 16px 0;font-size:14px;line-height:22px;color:#64748b;">
Если хочешь удалить аккаунт после скачивания — напиши на info@finkley.app, ответим в течение 5 рабочих дней.
</p>
</div>
<p style="margin:24px 0 0 0;font-size:12px;line-height:18px;color:#94a3b8;text-align:center;">Finkley · Управленческий учёт для салонов красоты<br>Вопросы — info@finkley.app</p>
</div>
</body>
</html>`,
  },

  weekly_digest: {
    subject: 'Finkley · итоги недели для {{salon_name}}',
    html: `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Итоги недели · Finkley</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
<div style="max-width:600px;margin:0 auto;padding:40px 20px;">
<div style="background:#ffffff;border-radius:8px;padding:40px;">

<p style="margin:0 0 24px 0;font-size:14px;font-weight:700;letter-spacing:0.05em;color:#1A1A2E;">FINKLEY · ИТОГИ НЕДЕЛИ</p>

<h1 style="margin:0 0 8px 0;font-size:22px;line-height:30px;color:#0f172a;">{{salon_name}}</h1>
{{logo_block}}
<p style="margin:0 0 24px 0;font-size:14px;color:#64748b;">{{period_start}} — {{period_end}}</p>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px;">
<tr>
<td width="33%" style="padding:14px 8px;background:#f1f5f9;border-radius:6px;text-align:center;vertical-align:top;">
<p style="margin:0 0 4px 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#64748b;">Выручка</p>
<p style="margin:0;font-size:18px;font-weight:700;color:#0f172a;">{{revenue}}</p>
<p style="margin:4px 0 0 0;font-size:12px;color:{{revenue_delta_color}};">{{revenue_delta}}</p>
</td>
<td width="2%"></td>
<td width="33%" style="padding:14px 8px;background:#f1f5f9;border-radius:6px;text-align:center;vertical-align:top;">
<p style="margin:0 0 4px 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#64748b;">Расходы</p>
<p style="margin:0;font-size:18px;font-weight:700;color:#0f172a;">{{expense}}</p>
</td>
<td width="2%"></td>
<td width="33%" style="padding:14px 8px;background:#ecfdf5;border-radius:6px;text-align:center;vertical-align:top;">
<p style="margin:0 0 4px 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#047857;">Прибыль</p>
<p style="margin:0;font-size:18px;font-weight:700;color:#065f46;">{{profit}}</p>
</td>
</tr>
</table>

<p style="margin:0 0 16px 0;font-size:14px;line-height:22px;color:#334155;">
За неделю: <strong>{{visits_count}}</strong> визитов.
</p>

{{top_block}}

{{insight_block}}

<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
<tr><td align="center" style="background:#1A1A2E;border-radius:6px;padding:14px 32px;">
<a href="{{app_url}}" style="color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">Открыть отчёты</a>
</td></tr>
</table>

<p style="margin:0;font-size:12px;line-height:18px;color:#94a3b8;">
Не хочешь больше получать дайджесты? Открой Settings и выключи «Еженедельный дайджест».
</p>

</div>
<p style="margin:24px 0 0 0;font-size:12px;line-height:18px;color:#94a3b8;text-align:center;">Finkley · Управленческий учёт для салонов красоты<br>info@finkley.app</p>
</div>
</body>
</html>`,
  },

  subscription_canceled: {
    subject: 'Подписка Finkley отменена',
    html: `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Подписка отменена</title>
</head>
<body style="margin:0; padding:0; background:#f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#0f172a;">

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f8fafc; padding: 40px 20px;">
<tr><td align="center">

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="background:#ffffff; border-radius:8px; padding:40px;">
<tr><td>

<h1 style="margin:0 0 16px 0; font-size:24px; line-height:32px; color:#0f172a;">
Привет, {{full_name}}.
</h1>

<p style="margin:0 0 16px 0; font-size:16px; line-height:24px; color:#334155;">
Подписка отменена. Жаль, что не подошло.
</p>

<p style="margin:0 0 16px 0; font-size:16px; line-height:24px; color:#334155;">
Доступ к Finkley сохранится до <strong>{{period_end_date}}</strong>. После этого аккаунт перейдёт в режим "только чтение" — данные будут видны, но добавлять новые записи нельзя.
</p>

<p style="margin:0 0 24px 0; font-size:16px; line-height:24px; color:#334155;">
Можешь скачать все свои данные в CSV — на случай если захочешь перейти в Excel или другой инструмент:
</p>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
<tr><td style="background:#f1f5f9; border-radius:6px; padding:12px 24px;">
<a href="{{export_url}}" style="color:#0f172a; text-decoration:none; font-weight:500; font-size:14px;">
📥 Экспорт данных
</a>
</td></tr>
</table>

<p style="margin:0 0 24px 0; font-size:16px; line-height:24px; color:#334155;">
Если передумаешь — можно вернуться в любой момент. Данные сохранятся 12 месяцев.
</p>

<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center" style="background:#0f172a; border-radius:6px; padding:14px 32px;">
<a href="{{resubscribe_url}}" style="color:#ffffff; text-decoration:none; font-weight:600; font-size:16px;">
Возобновить подписку
</a>
</td></tr>
</table>

<p style="margin:32px 0 16px 0; font-size:14px; line-height:22px; color:#64748b;">
Расскажи, почему отказалась? Один абзац очень помог бы сделать продукт лучше: <a href="mailto:info@finkley.app" style="color:#10b981; text-decoration:none;">info@finkley.app</a>
</p>

<p style="margin:24px 0 0 0; font-size:16px; line-height:24px; color:#334155;">
Спасибо что попробовала.<br>
{{owner_name}}
</p>

</td></tr>
</table>

<p style="margin:24px 0 0 0; font-size:12px; line-height:18px; color:#94a3b8; text-align:center;">
Finkley · &lt;юр.лицо&gt;, &lt;адрес&gt;, Польша
</p>

</td></tr>
</table>

</body>
</html>`,
  },

  team_invitation: {
    subject: '{{inviter_name}} зовёт тебя в Finkley',
    html: `<!DOCTYPE html>
<html lang="ru"><body style="margin:0;padding:0;background:#F7F4EE;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F7F4EE;padding:40px 16px;">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background:#fff;border-radius:12px;border:1px solid #E5E1D8;overflow:hidden;">
<tr><td style="padding:32px 32px 16px;">
  {{logo_block}}
  <p style="margin:0 0 8px 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#6B5B95;">Приглашение в команду</p>
  <h1 style="margin:0 0 12px 0;font-size:24px;line-height:30px;font-weight:800;color:#1A1A2E;">
    {{inviter_name}} зовёт тебя в&nbsp;«{{salon_name}}»
  </h1>
  <p style="margin:0 0 16px 0;font-size:15px;line-height:22px;color:#334155;">
    Тебя пригласили работать в Finkley в роли <strong>{{role}}</strong>.
    Прими приглашение, чтобы получить доступ к данным салона.
  </p>
  <p style="margin:24px 0;">
    <a href="{{invite_url}}" style="display:inline-block;background:#1A1A2E;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;font-size:15px;">
      Принять приглашение
    </a>
  </p>
  <p style="margin:0 0 8px 0;font-size:13px;color:#64748b;">
    Если кнопка не работает, скопируй ссылку:
  </p>
  <p style="margin:0 0 16px 0;font-size:12px;color:#0f172a;word-break:break-all;">
    <a href="{{invite_url}}" style="color:#0f172a;">{{invite_url}}</a>
  </p>
  <p style="margin:0;font-size:13px;color:#64748b;">
    Ссылка действует {{expires_in_days}} дней. Если ты не ждал такого приглашения — просто проигнорируй это письмо.
  </p>
</td></tr>
<tr><td style="padding:16px 32px 24px;border-top:1px solid #E5E1D8;">
  <p style="margin:0;font-size:12px;color:#94a3b8;">
    Finkley · управленческий учёт для салонов красоты
  </p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`,
  },

  bank_consent_expiring: {
    subject: 'Подключение «{{bank_name}}» истекает через {{days_left}} дн.',
    html: `<!DOCTYPE html>
<html lang="ru"><body style="margin:0;padding:0;background:#F7F4EE;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F7F4EE;padding:40px 16px;">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background:#fff;border-radius:12px;border:1px solid #E5E1D8;overflow:hidden;">
<tr><td style="padding:32px 32px 16px;">
  <p style="margin:0 0 8px 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#C9A24B;">Действие через {{days_left}} дн.</p>
  <h1 style="margin:0 0 12px 0;font-size:22px;line-height:28px;font-weight:800;color:#1A1A2E;">
    Подключение банка «{{bank_name}}» скоро истечёт
  </h1>
  <p style="margin:0 0 12px 0;font-size:15px;line-height:22px;color:#334155;">
    По правилам PSD2 банк требует, чтобы ты лично подтверждал доступ Finkley
    к транзакциям не реже, чем раз в 6 месяцев. Текущее подтверждение для
    «{{bank_name}}» ({{salon_name}}) истекает <strong>{{valid_until}}</strong>.
  </p>
  <p style="margin:0 0 12px 0;font-size:15px;line-height:22px;color:#334155;">
    Если не переподключить — авто-импорт расходов остановится. Ничего страшного:
    транзакции, которые уже подтянулись, никуда не денутся, ты просто перестанешь
    получать новые. Чтобы продолжить, нажми кнопку и пройди подтверждение в банке
    (займёт 30 секунд).
  </p>
  <p style="margin:24px 0;">
    <a href="{{reconnect_url}}" style="display:inline-block;background:#1A1A2E;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;font-size:15px;">
      Переподключить банк
    </a>
  </p>
  <p style="margin:0;font-size:13px;color:#64748b;">
    Если ты больше не пользуешься этим банком — можешь просто отключить его
    в настройках интеграций. Импортированные ранее расходы останутся.
  </p>
</td></tr>
<tr><td style="padding:16px 32px 24px;border-top:1px solid #E5E1D8;">
  <p style="margin:0;font-size:12px;color:#94a3b8;">
    Finkley · управленческий учёт для салонов красоты
  </p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`,
  },
}

export const ALLOWED_TEMPLATES = new Set<TemplateAlias>(Object.keys(TEMPLATES) as TemplateAlias[])

/**
 * Простая `{{var}}` подстановка. Незаданные ключи заменяются пустой строкой.
 */
export function render(template: string, vars: Record<string, string | number | null>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const v = vars[key]
    return v === null || v === undefined ? '' : String(v)
  })
}
