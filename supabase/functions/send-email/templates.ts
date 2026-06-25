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
  | 'privacy_alert'

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
    subject: 'Пробный период Finkley заканчивается совсем скоро',
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
Твой пробный период в Finkley заканчивается через <strong>{{days_left}}</strong> дн.
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

  privacy_alert: {
    subject: '🔒 Администратор {{actor_name}} просмотрел контакты {{client_count}}+ клиентов',
    html: `<!DOCTYPE html>
<html lang="ru"><body style="margin:0;padding:0;background:#F7F4EE;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F7F4EE;padding:40px 16px;">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background:#fff;border-radius:12px;border:1px solid #E5E1D8;overflow:hidden;">
<tr><td style="padding:32px 32px 16px;">
  <p style="margin:0 0 8px 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#C9A24B;">Уведомление о приватности</p>
  <h1 style="margin:0 0 12px 0;font-size:22px;line-height:28px;font-weight:800;color:#1A1A2E;">
    Администратор просмотрел контакты {{client_count}}+ клиентов
  </h1>
  <p style="margin:0 0 12px 0;font-size:15px;line-height:22px;color:#334155;">
    Сегодня администратор <strong>{{actor_name}}</strong> открыл список клиентов
    салона <strong>{{salon_name}}</strong>, в котором были видны контактные
    данные более чем {{client_count}} клиентов.
  </p>
  <p style="margin:0 0 12px 0;font-size:15px;line-height:22px;color:#334155;">
    Это штатное действие для роли «администратор» — она имеет полный доступ
    к клиентской базе по дефолту. Если ты хочешь скрыть контакты конкретно
    для этого человека или сменить ему роль на «мастер» / «бухгалтер»,
    зайди в раздел «Команда» в настройках салона.
  </p>
  <p style="margin:24px 0;">
    <a href="{{team_url}}" style="display:inline-block;background:#1A1A2E;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;font-size:15px;">
      Открыть раздел «Команда»
    </a>
  </p>
  <p style="margin:0;font-size:13px;color:#64748b;">
    Это автоматическое уведомление приходит максимум раз в день — даже если
    администратор повторно открывал список несколько раз.
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
 * Локализованные варианты шаблонов. Ключ — locale, значение — частичная карта
 * (можно покрывать не все шаблоны, отсутствующие наследуют RU из TEMPLATES).
 *
 * Статус локализации: все алиасы из TEMPLATES переведены на EN и PL (см.
 * LOCALE_OVERRIDES.en / .pl ниже). pickTemplate падает обратно на RU только
 * если для конкретного alias перевод когда-нибудь удалят. Паритет плейсхолдеров
 * {{var}} между ru/en/pl и отсутствие «тихого» RU-fallback проверяются в
 * templates.test.ts — новый непереведённый alias уронит тест, а не утечёт в прод.
 */
export type EmailLocale = 'ru' | 'pl' | 'en'

const WELCOME_EN: EmailTemplate = {
  subject: 'Hi from Finkley 👋',
  html: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Welcome to Finkley</title>
</head>
<body style="margin:0; padding:0; background:#f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#0f172a;">

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f8fafc; padding: 40px 20px;">
<tr><td align="center">

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="background:#ffffff; border-radius:8px; padding:40px;">
<tr><td>

{{logo_block}}

<h1 style="margin:0 0 16px 0; font-size:24px; line-height:32px; color:#0f172a;">
Hi {{full_name}}!
</h1>

<p style="margin:0 0 16px 0; font-size:16px; line-height:24px; color:#334155;">
Thanks for joining Finkley. Glad you're here.
</p>

<p style="margin:0 0 16px 0; font-size:16px; line-height:24px; color:#334155;">
Finkley helps you see the real profit of <strong>{{salon_name}}</strong> — after all expenses, without spreadsheets or a calculator.
</p>

<p style="margin:0 0 24px 0; font-size:16px; line-height:24px; color:#334155;">
To get started, add your first visit. Takes less than a minute:
</p>

<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center" style="background:#0f172a; border-radius:6px; padding:14px 32px;">
<a href="{{app_url}}" style="color:#ffffff; text-decoration:none; font-weight:600; font-size:16px;">
Open Finkley
</a>
</td></tr>
</table>

<p style="margin:32px 0 16px 0; font-size:16px; line-height:24px; color:#334155;">
You have a <strong>14-day free trial</strong>. No card, no tricks. If you don't like it — just don't pay.
</p>

<p style="margin:0 0 16px 0; font-size:16px; line-height:24px; color:#334155;">
Got questions or something not working — email me directly at <a href="mailto:info@finkley.app" style="color:#10b981; text-decoration:none;">info@finkley.app</a>. I reply personally.
</p>

<p style="margin:0; font-size:16px; line-height:24px; color:#334155;">
{{owner_name}}<br>
<span style="color:#64748b; font-size:14px;">Founder of Finkley</span>
</p>

</td></tr>
</table>

<p style="margin:24px 0 0 0; font-size:12px; line-height:18px; color:#94a3b8; text-align:center;">
Finkley · &lt;legal entity&gt;, &lt;address&gt;, Poland<br>
This is a transactional email. Questions about data processing — info@finkley.app
</p>

</td></tr>
</table>

</body>
</html>`,
}

const WELCOME_PL: EmailTemplate = {
  subject: 'Cześć od Finkley 👋',
  html: `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Witamy w Finkley</title>
</head>
<body style="margin:0; padding:0; background:#f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#0f172a;">

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f8fafc; padding: 40px 20px;">
<tr><td align="center">

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="background:#ffffff; border-radius:8px; padding:40px;">
<tr><td>

{{logo_block}}

<h1 style="margin:0 0 16px 0; font-size:24px; line-height:32px; color:#0f172a;">
Cześć, {{full_name}}!
</h1>

<p style="margin:0 0 16px 0; font-size:16px; line-height:24px; color:#334155;">
Dzięki, że dołączasz do Finkley. Cieszymy się, że jesteś z nami.
</p>

<p style="margin:0 0 16px 0; font-size:16px; line-height:24px; color:#334155;">
Finkley pomoże Ci zobaczyć realny zysk Twojego salonu <strong>{{salon_name}}</strong> — po wszystkich wydatkach, bez arkuszy i kalkulatora.
</p>

<p style="margin:0 0 24px 0; font-size:16px; line-height:24px; color:#334155;">
Aby zacząć, dodaj pierwszą wizytę. Zajmie to mniej niż minutę:
</p>

<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center" style="background:#0f172a; border-radius:6px; padding:14px 32px;">
<a href="{{app_url}}" style="color:#ffffff; text-decoration:none; font-weight:600; font-size:16px;">
Otwórz Finkley
</a>
</td></tr>
</table>

<p style="margin:32px 0 16px 0; font-size:16px; line-height:24px; color:#334155;">
Masz <strong>14 dni bezpłatnego okresu próbnego</strong>. Bez karty, bez kruczków. Jeśli coś Ci się nie spodoba — po prostu nie płacisz.
</p>

<p style="margin:0 0 16px 0; font-size:16px; line-height:24px; color:#334155;">
Pytania albo coś nie działa — napisz na <a href="mailto:info@finkley.app" style="color:#10b981; text-decoration:none;">info@finkley.app</a>. Odpowiadam osobiście.
</p>

<p style="margin:0; font-size:16px; line-height:24px; color:#334155;">
{{owner_name}}<br>
<span style="color:#64748b; font-size:14px;">Twórca Finkley</span>
</p>

</td></tr>
</table>

<p style="margin:24px 0 0 0; font-size:12px; line-height:18px; color:#94a3b8; text-align:center;">
Finkley · &lt;podmiot prawny&gt;, &lt;adres&gt;, Polska<br>
To wiadomość transakcyjna. Pytania o przetwarzanie danych — info@finkley.app
</p>

</td></tr>
</table>

</body>
</html>`,
}

const TEAM_INVITATION_EN: EmailTemplate = {
  subject: '{{inviter_name}} invited you to Finkley',
  html: `<!DOCTYPE html>
<html lang="en"><body style="margin:0;padding:0;background:#F7F4EE;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F7F4EE;padding:40px 16px;">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background:#fff;border-radius:12px;border:1px solid #E5E1D8;overflow:hidden;">
<tr><td style="padding:32px 32px 16px;">
  {{logo_block}}
  <p style="margin:0 0 8px 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#6B5B95;">Team invitation</p>
  <h1 style="margin:0 0 12px 0;font-size:24px;line-height:30px;font-weight:800;color:#1A1A2E;">
    {{inviter_name}} invited you to&nbsp;'{{salon_name}}'
  </h1>
  <p style="margin:0 0 16px 0;font-size:15px;line-height:22px;color:#334155;">
    You've been invited to work in Finkley as <strong>{{role}}</strong>.
    Accept the invitation to get access to the salon's data.
  </p>
  <p style="margin:24px 0;">
    <a href="{{invite_url}}" style="display:inline-block;background:#1A1A2E;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;font-size:15px;">
      Accept invitation
    </a>
  </p>
  <p style="margin:0 0 8px 0;font-size:13px;color:#64748b;">
    If the button doesn't work, copy the link:
  </p>
  <p style="margin:0 0 16px 0;font-size:12px;color:#0f172a;word-break:break-all;">
    <a href="{{invite_url}}" style="color:#0f172a;">{{invite_url}}</a>
  </p>
  <p style="margin:0;font-size:13px;color:#64748b;">
    Link is valid for {{expires_in_days}} days. If you weren't expecting this invitation — just ignore this email.
  </p>
</td></tr>
<tr><td style="padding:16px 32px 24px;border-top:1px solid #E5E1D8;">
  <p style="margin:0;font-size:12px;color:#94a3b8;">
    Finkley · management accounting for beauty salons
  </p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`,
}

const TEAM_INVITATION_PL: EmailTemplate = {
  subject: '{{inviter_name}} zaprasza Cię do Finkley',
  html: `<!DOCTYPE html>
<html lang="pl"><body style="margin:0;padding:0;background:#F7F4EE;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F7F4EE;padding:40px 16px;">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background:#fff;border-radius:12px;border:1px solid #E5E1D8;overflow:hidden;">
<tr><td style="padding:32px 32px 16px;">
  {{logo_block}}
  <p style="margin:0 0 8px 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#6B5B95;">Zaproszenie do zespołu</p>
  <h1 style="margin:0 0 12px 0;font-size:24px;line-height:30px;font-weight:800;color:#1A1A2E;">
    {{inviter_name}} zaprasza Cię do&nbsp;„{{salon_name}}"
  </h1>
  <p style="margin:0 0 16px 0;font-size:15px;line-height:22px;color:#334155;">
    Zostałeś zaproszony do pracy w Finkley w roli <strong>{{role}}</strong>.
    Przyjmij zaproszenie, aby uzyskać dostęp do danych salonu.
  </p>
  <p style="margin:24px 0;">
    <a href="{{invite_url}}" style="display:inline-block;background:#1A1A2E;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;font-size:15px;">
      Przyjmij zaproszenie
    </a>
  </p>
  <p style="margin:0 0 8px 0;font-size:13px;color:#64748b;">
    Jeśli przycisk nie działa, skopiuj link:
  </p>
  <p style="margin:0 0 16px 0;font-size:12px;color:#0f172a;word-break:break-all;">
    <a href="{{invite_url}}" style="color:#0f172a;">{{invite_url}}</a>
  </p>
  <p style="margin:0;font-size:13px;color:#64748b;">
    Link jest ważny przez {{expires_in_days}} dni. Jeśli nie spodziewałeś się tego zaproszenia — po prostu zignoruj tę wiadomość.
  </p>
</td></tr>
<tr><td style="padding:16px 32px 24px;border-top:1px solid #E5E1D8;">
  <p style="margin:0;font-size:12px;color:#94a3b8;">
    Finkley · księgowość zarządcza dla salonów kosmetycznych
  </p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`,
}

const WEEKLY_DIGEST_EN: EmailTemplate = {
  subject: 'Finkley · weekly summary for {{salon_name}}',
  html: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Weekly summary · Finkley</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
<div style="max-width:600px;margin:0 auto;padding:40px 20px;">
<div style="background:#ffffff;border-radius:8px;padding:40px;">

<p style="margin:0 0 24px 0;font-size:14px;font-weight:700;letter-spacing:0.05em;color:#1A1A2E;">FINKLEY · WEEKLY SUMMARY</p>

<h1 style="margin:0 0 8px 0;font-size:22px;line-height:30px;color:#0f172a;">{{salon_name}}</h1>
{{logo_block}}
<p style="margin:0 0 24px 0;font-size:14px;color:#64748b;">{{period_start}} — {{period_end}}</p>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px;">
<tr>
<td width="33%" style="padding:14px 8px;background:#f1f5f9;border-radius:6px;text-align:center;vertical-align:top;">
<p style="margin:0 0 4px 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#64748b;">Revenue</p>
<p style="margin:0;font-size:18px;font-weight:700;color:#0f172a;">{{revenue}}</p>
<p style="margin:4px 0 0 0;font-size:12px;color:{{revenue_delta_color}};">{{revenue_delta}}</p>
</td>
<td width="2%"></td>
<td width="33%" style="padding:14px 8px;background:#f1f5f9;border-radius:6px;text-align:center;vertical-align:top;">
<p style="margin:0 0 4px 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#64748b;">Expenses</p>
<p style="margin:0;font-size:18px;font-weight:700;color:#0f172a;">{{expense}}</p>
</td>
<td width="2%"></td>
<td width="33%" style="padding:14px 8px;background:#ecfdf5;border-radius:6px;text-align:center;vertical-align:top;">
<p style="margin:0 0 4px 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#047857;">Profit</p>
<p style="margin:0;font-size:18px;font-weight:700;color:#065f46;">{{profit}}</p>
</td>
</tr>
</table>

<p style="margin:0 0 16px 0;font-size:14px;line-height:22px;color:#334155;">
This week: <strong>{{visits_count}}</strong> visits.
</p>

{{top_block}}

{{insight_block}}

<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
<tr><td align="center" style="background:#1A1A2E;border-radius:6px;padding:14px 32px;">
<a href="{{app_url}}" style="color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">Open reports</a>
</td></tr>
</table>

<p style="margin:0;font-size:12px;line-height:18px;color:#94a3b8;">
Don't want digests anymore? Open Settings and turn off 'Weekly digest'.
</p>

</div>
<p style="margin:24px 0 0 0;font-size:12px;line-height:18px;color:#94a3b8;text-align:center;">Finkley · Management accounting for beauty salons<br>info@finkley.app</p>
</div>
</body>
</html>`,
}

const WEEKLY_DIGEST_PL: EmailTemplate = {
  subject: 'Finkley · podsumowanie tygodnia dla {{salon_name}}',
  html: `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Podsumowanie tygodnia · Finkley</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
<div style="max-width:600px;margin:0 auto;padding:40px 20px;">
<div style="background:#ffffff;border-radius:8px;padding:40px;">

<p style="margin:0 0 24px 0;font-size:14px;font-weight:700;letter-spacing:0.05em;color:#1A1A2E;">FINKLEY · PODSUMOWANIE TYGODNIA</p>

<h1 style="margin:0 0 8px 0;font-size:22px;line-height:30px;color:#0f172a;">{{salon_name}}</h1>
{{logo_block}}
<p style="margin:0 0 24px 0;font-size:14px;color:#64748b;">{{period_start}} — {{period_end}}</p>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px;">
<tr>
<td width="33%" style="padding:14px 8px;background:#f1f5f9;border-radius:6px;text-align:center;vertical-align:top;">
<p style="margin:0 0 4px 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#64748b;">Przychód</p>
<p style="margin:0;font-size:18px;font-weight:700;color:#0f172a;">{{revenue}}</p>
<p style="margin:4px 0 0 0;font-size:12px;color:{{revenue_delta_color}};">{{revenue_delta}}</p>
</td>
<td width="2%"></td>
<td width="33%" style="padding:14px 8px;background:#f1f5f9;border-radius:6px;text-align:center;vertical-align:top;">
<p style="margin:0 0 4px 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#64748b;">Wydatki</p>
<p style="margin:0;font-size:18px;font-weight:700;color:#0f172a;">{{expense}}</p>
</td>
<td width="2%"></td>
<td width="33%" style="padding:14px 8px;background:#ecfdf5;border-radius:6px;text-align:center;vertical-align:top;">
<p style="margin:0 0 4px 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#047857;">Zysk</p>
<p style="margin:0;font-size:18px;font-weight:700;color:#065f46;">{{profit}}</p>
</td>
</tr>
</table>

<p style="margin:0 0 16px 0;font-size:14px;line-height:22px;color:#334155;">
W tym tygodniu: <strong>{{visits_count}}</strong> wizyt.
</p>

{{top_block}}

{{insight_block}}

<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
<tr><td align="center" style="background:#1A1A2E;border-radius:6px;padding:14px 32px;">
<a href="{{app_url}}" style="color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">Otwórz raporty</a>
</td></tr>
</table>

<p style="margin:0;font-size:12px;line-height:18px;color:#94a3b8;">
Nie chcesz więcej digestów? Otwórz Ustawienia i wyłącz „Cotygodniowy digest".
</p>

</div>
<p style="margin:24px 0 0 0;font-size:12px;line-height:18px;color:#94a3b8;text-align:center;">Finkley · Księgowość zarządcza dla salonów kosmetycznych<br>info@finkley.app</p>
</div>
</body>
</html>`,
}

const TRIAL_ENDING_EN: EmailTemplate = {
  subject: 'Your trial ends in {{days_left}} days',
  html: `<!DOCTYPE html>
<html lang="en"><body style="margin:0; padding:0; background:#f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#0f172a;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f8fafc; padding: 40px 20px;">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="background:#ffffff; border-radius:8px; padding:40px;">
<tr><td>
<h1 style="margin:0 0 16px 0; font-size:24px; line-height:32px; color:#0f172a;">Hi {{full_name}}.</h1>
<p style="margin:0 0 16px 0; font-size:16px; line-height:24px; color:#334155;">
Your Finkley trial ends in <strong>{{days_left}} days</strong>.
</p>
<p style="margin:0 0 24px 0; font-size:16px; line-height:24px; color:#334155;">
So far you've recorded <strong>{{visits_during_trial}}</strong> visits for <strong>{{revenue_during_trial}}</strong>. Nice start.
</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f1f5f9; border-radius:6px; padding:20px; margin-bottom:24px;">
<tr><td>
<p style="margin:0 0 8px 0; font-size:14px; color:#64748b;">Finkley Standard plan</p>
<p style="margin:0 0 4px 0; font-size:24px; font-weight:600; color:#0f172a;">€15 / month</p>
<p style="margin:0; font-size:14px; color:#64748b;">VAT added automatically by your country</p>
</td></tr>
</table>
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center" style="background:#0f172a; border-radius:6px; padding:14px 32px;">
<a href="{{billing_url}}" style="color:#ffffff; text-decoration:none; font-weight:600; font-size:16px;">Subscribe</a>
</td></tr>
</table>
<p style="margin:32px 0 16px 0; font-size:14px; line-height:22px; color:#64748b;">
Card payment via Stripe — secure. 7-day money-back guarantee — if you change your mind, we'll refund.
</p>
<p style="margin:0 0 16px 0; font-size:14px; line-height:22px; color:#64748b;">
If you decide not to continue — your data is preserved for 30 days, then deleted. Until then you can export everything to CSV.
</p>
<p style="margin:24px 0 0 0; font-size:16px; line-height:24px; color:#334155;">{{owner_name}}<br>
<span style="color:#64748b; font-size:14px;">info@finkley.app</span></p>
</td></tr>
</table>
<p style="margin:24px 0 0 0; font-size:12px; line-height:18px; color:#94a3b8; text-align:center;">
Finkley · &lt;legal entity&gt;, &lt;address&gt;, Poland
</p>
</td></tr></table></body></html>`,
}

const TRIAL_ENDING_PL: EmailTemplate = {
  subject: 'Twój okres próbny kończy się za {{days_left}} dni',
  html: `<!DOCTYPE html>
<html lang="pl"><body style="margin:0; padding:0; background:#f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#0f172a;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f8fafc; padding: 40px 20px;">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="background:#ffffff; border-radius:8px; padding:40px;">
<tr><td>
<h1 style="margin:0 0 16px 0; font-size:24px; line-height:32px; color:#0f172a;">Cześć, {{full_name}}.</h1>
<p style="margin:0 0 16px 0; font-size:16px; line-height:24px; color:#334155;">
Twój okres próbny w Finkley kończy się za <strong>{{days_left}} dni</strong>.
</p>
<p style="margin:0 0 24px 0; font-size:16px; line-height:24px; color:#334155;">
W tym czasie wprowadziłeś <strong>{{visits_during_trial}}</strong> wizyt na kwotę <strong>{{revenue_during_trial}}</strong>. Dobry początek.
</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f1f5f9; border-radius:6px; padding:20px; margin-bottom:24px;">
<tr><td>
<p style="margin:0 0 8px 0; font-size:14px; color:#64748b;">Plan Finkley Standard</p>
<p style="margin:0 0 4px 0; font-size:24px; font-weight:600; color:#0f172a;">15 € / miesiąc</p>
<p style="margin:0; font-size:14px; color:#64748b;">VAT dodawany automatycznie w zależności od kraju</p>
</td></tr>
</table>
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center" style="background:#0f172a; border-radius:6px; padding:14px 32px;">
<a href="{{billing_url}}" style="color:#ffffff; text-decoration:none; font-weight:600; font-size:16px;">Aktywuj subskrypcję</a>
</td></tr>
</table>
<p style="margin:32px 0 16px 0; font-size:14px; line-height:22px; color:#64748b;">
Płatność kartą przez Stripe — bezpiecznie. 7-dniowa gwarancja zwrotu — jeśli zmienisz zdanie, zwrócimy pieniądze.
</p>
<p style="margin:0 0 16px 0; font-size:14px; line-height:22px; color:#64748b;">
Jeśli zdecydujesz nie kontynuować — Twoje dane zostaną zachowane 30 dni, potem usunięte. Do tego czasu możesz wyeksportować wszystko do CSV.
</p>
<p style="margin:24px 0 0 0; font-size:16px; line-height:24px; color:#334155;">{{owner_name}}<br>
<span style="color:#64748b; font-size:14px;">info@finkley.app</span></p>
</td></tr>
</table>
<p style="margin:24px 0 0 0; font-size:12px; line-height:18px; color:#94a3b8; text-align:center;">
Finkley · &lt;podmiot prawny&gt;, &lt;adres&gt;, Polska
</p>
</td></tr></table></body></html>`,
}

const PAYMENT_SUCCEEDED_EN: EmailTemplate = {
  subject: 'Thanks for the payment · Finkley',
  html: `<!DOCTYPE html>
<html lang="en"><body style="margin:0; padding:0; background:#f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#0f172a;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f8fafc; padding: 40px 20px;">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="background:#ffffff; border-radius:8px; padding:40px;">
<tr><td>
<h1 style="margin:0 0 16px 0; font-size:24px; line-height:32px; color:#0f172a;">Thank you, {{full_name}}!</h1>
<p style="margin:0 0 24px 0; font-size:16px; line-height:24px; color:#334155;">
Payment received. Finkley is running at full power.
</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#ecfdf5; border-radius:6px; padding:20px; margin-bottom:24px;">
<tr><td>
<p style="margin:0 0 4px 0; font-size:14px; color:#047857;">Paid</p>
<p style="margin:0 0 8px 0; font-size:24px; font-weight:600; color:#065f46;">{{amount}}</p>
<p style="margin:0; font-size:14px; color:#065f46;">Next charge: {{period_end_date}}</p>
</td></tr>
</table>
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr><td style="background:#f1f5f9; border-radius:6px; padding:12px 24px;">
<a href="{{invoice_url}}" style="color:#0f172a; text-decoration:none; font-weight:500; font-size:14px;">📄 Download invoice</a>
</td></tr>
</table>
<p style="margin:32px 0 16px 0; font-size:14px; line-height:22px; color:#64748b;">
Manage subscription, change card or cancel — in the Billing section inside the app.
</p>
<p style="margin:24px 0 0 0; font-size:16px; line-height:24px; color:#334155;">{{owner_name}}</p>
</td></tr></table>
<p style="margin:24px 0 0 0; font-size:12px; line-height:18px; color:#94a3b8; text-align:center;">Finkley · &lt;legal entity&gt;, &lt;address&gt;, Poland</p>
</td></tr></table></body></html>`,
}

const PAYMENT_SUCCEEDED_PL: EmailTemplate = {
  subject: 'Dziękujemy za płatność · Finkley',
  html: `<!DOCTYPE html>
<html lang="pl"><body style="margin:0; padding:0; background:#f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#0f172a;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f8fafc; padding: 40px 20px;">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="background:#ffffff; border-radius:8px; padding:40px;">
<tr><td>
<h1 style="margin:0 0 16px 0; font-size:24px; line-height:32px; color:#0f172a;">Dziękujemy, {{full_name}}!</h1>
<p style="margin:0 0 24px 0; font-size:16px; line-height:24px; color:#334155;">
Płatność przeszła pomyślnie. Finkley działa na pełną moc.
</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#ecfdf5; border-radius:6px; padding:20px; margin-bottom:24px;">
<tr><td>
<p style="margin:0 0 4px 0; font-size:14px; color:#047857;">Opłacono</p>
<p style="margin:0 0 8px 0; font-size:24px; font-weight:600; color:#065f46;">{{amount}}</p>
<p style="margin:0; font-size:14px; color:#065f46;">Następne obciążenie: {{period_end_date}}</p>
</td></tr>
</table>
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr><td style="background:#f1f5f9; border-radius:6px; padding:12px 24px;">
<a href="{{invoice_url}}" style="color:#0f172a; text-decoration:none; font-weight:500; font-size:14px;">📄 Pobierz fakturę</a>
</td></tr>
</table>
<p style="margin:32px 0 16px 0; font-size:14px; line-height:22px; color:#64748b;">
Zarządzanie subskrypcją, zmiana karty lub anulowanie — w sekcji Billing w aplikacji.
</p>
<p style="margin:24px 0 0 0; font-size:16px; line-height:24px; color:#334155;">{{owner_name}}</p>
</td></tr></table>
<p style="margin:24px 0 0 0; font-size:12px; line-height:18px; color:#94a3b8; text-align:center;">Finkley · &lt;podmiot prawny&gt;, &lt;adres&gt;, Polska</p>
</td></tr></table></body></html>`,
}

const PAYMENT_FAILED_EN: EmailTemplate = {
  subject: 'Payment failed · Finkley',
  html: `<!DOCTYPE html>
<html lang="en"><body style="margin:0; padding:0; background:#f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#0f172a;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f8fafc; padding: 40px 20px;">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="background:#ffffff; border-radius:8px; padding:40px;">
<tr><td>
<h1 style="margin:0 0 16px 0; font-size:24px; line-height:32px; color:#0f172a;">Hi {{full_name}}.</h1>
<p style="margin:0 0 16px 0; font-size:16px; line-height:24px; color:#334155;">
We tried to charge <strong>{{amount}}</strong> for your Finkley subscription, but the payment didn't go through.
</p>
<p style="margin:0 0 24px 0; font-size:16px; line-height:24px; color:#334155;">
Could be: insufficient funds, expired card, or 3D-Secure verification needed. Stripe will retry on <strong>{{retry_date}}</strong>.
</p>
<p style="margin:0 0 24px 0; font-size:16px; line-height:24px; color:#334155;">
To keep access — update your card or confirm the payment:
</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center" style="background:#0f172a; border-radius:6px; padding:14px 32px;">
<a href="{{billing_url}}" style="color:#ffffff; text-decoration:none; font-weight:600; font-size:16px;">Manage subscription</a>
</td></tr>
</table>
<p style="margin:32px 0 16px 0; font-size:14px; line-height:22px; color:#64748b;">
Access to Finkley remains for a few more days. If payment fails after several retries — the account goes to "read-only", but data is preserved.
</p>
<p style="margin:0 0 16px 0; font-size:14px; line-height:22px; color:#64748b;">
Questions — email <a href="mailto:info@finkley.app" style="color:#10b981; text-decoration:none;">info@finkley.app</a>.
</p>
<p style="margin:24px 0 0 0; font-size:16px; line-height:24px; color:#334155;">{{owner_name}}</p>
</td></tr></table>
<p style="margin:24px 0 0 0; font-size:12px; line-height:18px; color:#94a3b8; text-align:center;">Finkley · &lt;legal entity&gt;, &lt;address&gt;, Poland</p>
</td></tr></table></body></html>`,
}

const PAYMENT_FAILED_PL: EmailTemplate = {
  subject: 'Nie udało się pobrać płatności · Finkley',
  html: `<!DOCTYPE html>
<html lang="pl"><body style="margin:0; padding:0; background:#f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#0f172a;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f8fafc; padding: 40px 20px;">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="background:#ffffff; border-radius:8px; padding:40px;">
<tr><td>
<h1 style="margin:0 0 16px 0; font-size:24px; line-height:32px; color:#0f172a;">Cześć, {{full_name}}.</h1>
<p style="margin:0 0 16px 0; font-size:16px; line-height:24px; color:#334155;">
Próbowaliśmy pobrać <strong>{{amount}}</strong> za subskrypcję Finkley, ale płatność się nie powiodła.
</p>
<p style="margin:0 0 24px 0; font-size:16px; line-height:24px; color:#334155;">
Możliwe przyczyny: brak środków, wygasła karta lub potrzebne potwierdzenie 3D-Secure. Stripe spróbuje ponownie <strong>{{retry_date}}</strong>.
</p>
<p style="margin:0 0 24px 0; font-size:16px; line-height:24px; color:#334155;">
Aby nie utracić dostępu — zaktualizuj kartę lub potwierdź płatność:
</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center" style="background:#0f172a; border-radius:6px; padding:14px 32px;">
<a href="{{billing_url}}" style="color:#ffffff; text-decoration:none; font-weight:600; font-size:16px;">Zarządzaj subskrypcją</a>
</td></tr>
</table>
<p style="margin:32px 0 16px 0; font-size:14px; line-height:22px; color:#64748b;">
Dostęp do Finkley pozostaje jeszcze kilka dni. Jeśli płatność się nie powiedzie po kilku próbach — konto przejdzie w tryb "tylko do odczytu", ale dane pozostaną.
</p>
<p style="margin:0 0 16px 0; font-size:14px; line-height:22px; color:#64748b;">
Pytania — napisz na <a href="mailto:info@finkley.app" style="color:#10b981; text-decoration:none;">info@finkley.app</a>.
</p>
<p style="margin:24px 0 0 0; font-size:16px; line-height:24px; color:#334155;">{{owner_name}}</p>
</td></tr></table>
<p style="margin:24px 0 0 0; font-size:12px; line-height:18px; color:#94a3b8; text-align:center;">Finkley · &lt;podmiot prawny&gt;, &lt;adres&gt;, Polska</p>
</td></tr></table></body></html>`,
}

const SUBSCRIPTION_CANCELED_EN: EmailTemplate = {
  subject: 'Finkley subscription canceled',
  html: `<!DOCTYPE html>
<html lang="en"><body style="margin:0; padding:0; background:#f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#0f172a;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f8fafc; padding: 40px 20px;">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="background:#ffffff; border-radius:8px; padding:40px;">
<tr><td>
<h1 style="margin:0 0 16px 0; font-size:24px; line-height:32px; color:#0f172a;">Hi {{full_name}}.</h1>
<p style="margin:0 0 16px 0; font-size:16px; line-height:24px; color:#334155;">
Subscription canceled. Sorry it didn't work out.
</p>
<p style="margin:0 0 16px 0; font-size:16px; line-height:24px; color:#334155;">
Finkley access remains until <strong>{{period_end_date}}</strong>. After that, the account goes to "read-only" — data is visible, but no new entries can be added.
</p>
<p style="margin:0 0 24px 0; font-size:16px; line-height:24px; color:#334155;">
You can export all your data to CSV — in case you want to move to Excel or another tool:
</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
<tr><td style="background:#f1f5f9; border-radius:6px; padding:12px 24px;">
<a href="{{export_url}}" style="color:#0f172a; text-decoration:none; font-weight:500; font-size:14px;">📥 Export data</a>
</td></tr>
</table>
<p style="margin:0 0 24px 0; font-size:16px; line-height:24px; color:#334155;">
If you change your mind — you can come back anytime. Data is preserved for 12 months.
</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center" style="background:#0f172a; border-radius:6px; padding:14px 32px;">
<a href="{{resubscribe_url}}" style="color:#ffffff; text-decoration:none; font-weight:600; font-size:16px;">Resume subscription</a>
</td></tr>
</table>
<p style="margin:32px 0 16px 0; font-size:14px; line-height:22px; color:#64748b;">
Tell us why you canceled? One paragraph would really help make the product better: <a href="mailto:info@finkley.app" style="color:#10b981; text-decoration:none;">info@finkley.app</a>
</p>
<p style="margin:24px 0 0 0; font-size:16px; line-height:24px; color:#334155;">
Thanks for trying.<br>{{owner_name}}
</p>
</td></tr></table>
<p style="margin:24px 0 0 0; font-size:12px; line-height:18px; color:#94a3b8; text-align:center;">Finkley · &lt;legal entity&gt;, &lt;address&gt;, Poland</p>
</td></tr></table></body></html>`,
}

const SUBSCRIPTION_CANCELED_PL: EmailTemplate = {
  subject: 'Subskrypcja Finkley anulowana',
  html: `<!DOCTYPE html>
<html lang="pl"><body style="margin:0; padding:0; background:#f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#0f172a;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f8fafc; padding: 40px 20px;">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="background:#ffffff; border-radius:8px; padding:40px;">
<tr><td>
<h1 style="margin:0 0 16px 0; font-size:24px; line-height:32px; color:#0f172a;">Cześć, {{full_name}}.</h1>
<p style="margin:0 0 16px 0; font-size:16px; line-height:24px; color:#334155;">
Subskrypcja anulowana. Szkoda, że nie podeszło.
</p>
<p style="margin:0 0 16px 0; font-size:16px; line-height:24px; color:#334155;">
Dostęp do Finkley pozostaje do <strong>{{period_end_date}}</strong>. Później konto przejdzie w tryb "tylko do odczytu" — dane będą widoczne, ale nie można będzie dodawać nowych wpisów.
</p>
<p style="margin:0 0 24px 0; font-size:16px; line-height:24px; color:#334155;">
Możesz wyeksportować wszystkie dane do CSV — na wypadek przejścia do Excel lub innego narzędzia:
</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
<tr><td style="background:#f1f5f9; border-radius:6px; padding:12px 24px;">
<a href="{{export_url}}" style="color:#0f172a; text-decoration:none; font-weight:500; font-size:14px;">📥 Eksport danych</a>
</td></tr>
</table>
<p style="margin:0 0 24px 0; font-size:16px; line-height:24px; color:#334155;">
Jeśli zmienisz zdanie — możesz wrócić w dowolnym momencie. Dane zachowane przez 12 miesięcy.
</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center" style="background:#0f172a; border-radius:6px; padding:14px 32px;">
<a href="{{resubscribe_url}}" style="color:#ffffff; text-decoration:none; font-weight:600; font-size:16px;">Wznów subskrypcję</a>
</td></tr>
</table>
<p style="margin:32px 0 16px 0; font-size:14px; line-height:22px; color:#64748b;">
Powiedz, dlaczego anulowałeś? Jeden akapit naprawdę pomógłby ulepszyć produkt: <a href="mailto:info@finkley.app" style="color:#10b981; text-decoration:none;">info@finkley.app</a>
</p>
<p style="margin:24px 0 0 0; font-size:16px; line-height:24px; color:#334155;">
Dzięki, że próbowałeś.<br>{{owner_name}}
</p>
</td></tr></table>
<p style="margin:24px 0 0 0; font-size:12px; line-height:18px; color:#94a3b8; text-align:center;">Finkley · &lt;podmiot prawny&gt;, &lt;adres&gt;, Polska</p>
</td></tr></table></body></html>`,
}

const GDPR_EXPORT_EN: EmailTemplate = {
  subject: 'Your Finkley data archive is ready',
  html: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Finkley data archive</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
<div style="max-width:600px;margin:0 auto;padding:40px 20px;">
<div style="background:#ffffff;border-radius:8px;padding:40px;">
<p style="margin:0 0 24px 0;font-size:14px;font-weight:700;letter-spacing:0.05em;color:#1A1A2E;">FINKLEY</p>
<h1 style="margin:0 0 16px 0;font-size:22px;line-height:30px;color:#0f172a;">Archive ready</h1>
<p style="margin:0 0 16px 0;font-size:16px;line-height:24px;color:#334155;">
Hi {{full_name}}. We've packed all your Finkley data into one ZIP archive.
</p>
<p style="margin:0 0 24px 0;font-size:16px;line-height:24px;color:#334155;">
The link is valid for 24 hours. After that, you'll need to request a new export.
</p>
<p style="margin:0 0 24px 0;">
<a href="{{download_url}}" style="display:inline-block;background:#1A1A2E;color:#ffffff;padding:14px 32px;text-decoration:none;border-radius:6px;font-weight:600;font-size:16px;">Download archive</a>
</p>
<p style="margin:24px 0 16px 0;font-size:14px;line-height:22px;color:#64748b;">
Inside — CSVs of your visits, expenses, clients, masters, services and categories. README.txt explains every column.
</p>
<p style="margin:0 0 16px 0;font-size:14px;line-height:22px;color:#64748b;">
If you want to delete the account after downloading — email info@finkley.app, we'll reply within 5 business days.
</p>
</div>
<p style="margin:24px 0 0 0;font-size:12px;line-height:18px;color:#94a3b8;text-align:center;">Finkley · Management accounting for beauty salons<br>Questions — info@finkley.app</p>
</div>
</body>
</html>`,
}

const GDPR_EXPORT_PL: EmailTemplate = {
  subject: 'Twoje archiwum danych Finkley jest gotowe',
  html: `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Archiwum danych Finkley</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
<div style="max-width:600px;margin:0 auto;padding:40px 20px;">
<div style="background:#ffffff;border-radius:8px;padding:40px;">
<p style="margin:0 0 24px 0;font-size:14px;font-weight:700;letter-spacing:0.05em;color:#1A1A2E;">FINKLEY</p>
<h1 style="margin:0 0 16px 0;font-size:22px;line-height:30px;color:#0f172a;">Archiwum gotowe</h1>
<p style="margin:0 0 16px 0;font-size:16px;line-height:24px;color:#334155;">
Cześć, {{full_name}}. Spakowaliśmy wszystkie Twoje dane Finkley w jedno archiwum ZIP.
</p>
<p style="margin:0 0 24px 0;font-size:16px;line-height:24px;color:#334155;">
Link jest ważny 24 godziny. Później trzeba poprosić o nowy eksport.
</p>
<p style="margin:0 0 24px 0;">
<a href="{{download_url}}" style="display:inline-block;background:#1A1A2E;color:#ffffff;padding:14px 32px;text-decoration:none;border-radius:6px;font-weight:600;font-size:16px;">Pobierz archiwum</a>
</p>
<p style="margin:24px 0 16px 0;font-size:14px;line-height:22px;color:#64748b;">
W środku — CSV z wizytami, wydatkami, klientami, mistrzami, usługami i kategoriami. README.txt wyjaśnia każdą kolumnę.
</p>
<p style="margin:0 0 16px 0;font-size:14px;line-height:22px;color:#64748b;">
Chcesz usunąć konto po pobraniu? — napisz na info@finkley.app, odpowiemy w ciągu 5 dni roboczych.
</p>
</div>
<p style="margin:24px 0 0 0;font-size:12px;line-height:18px;color:#94a3b8;text-align:center;">Finkley · Księgowość zarządcza dla salonów kosmetycznych<br>Pytania — info@finkley.app</p>
</div>
</body>
</html>`,
}

const PRIVACY_ALERT_EN: EmailTemplate = {
  subject: '🔒 Admin {{actor_name}} viewed contacts of {{client_count}}+ clients',
  html: `<!DOCTYPE html>
<html lang="en"><body style="margin:0;padding:0;background:#F7F4EE;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F7F4EE;padding:40px 16px;">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background:#fff;border-radius:12px;border:1px solid #E5E1D8;overflow:hidden;">
<tr><td style="padding:32px 32px 16px;">
  <p style="margin:0 0 8px 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#C9A24B;">Privacy notice</p>
  <h1 style="margin:0 0 12px 0;font-size:22px;line-height:28px;font-weight:800;color:#1A1A2E;">
    Admin viewed contacts of {{client_count}}+ clients
  </h1>
  <p style="margin:0 0 12px 0;font-size:15px;line-height:22px;color:#334155;">
    Today admin <strong>{{actor_name}}</strong> opened the client list of salon
    <strong>{{salon_name}}</strong>, which showed contact details of more than
    {{client_count}} clients.
  </p>
  <p style="margin:0 0 12px 0;font-size:15px;line-height:22px;color:#334155;">
    This is a standard action for the 'admin' role — it has full access to the
    client base by default. If you want to hide contacts specifically from this
    person, or change their role to 'master' / 'accountant', go to the 'Team'
    section in salon settings.
  </p>
  <p style="margin:24px 0;">
    <a href="{{team_url}}" style="display:inline-block;background:#1A1A2E;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;font-size:15px;">
      Open 'Team' section
    </a>
  </p>
  <p style="margin:0;font-size:13px;color:#64748b;">
    This automatic notification comes at most once a day — even if admin opened the list multiple times.
  </p>
</td></tr>
<tr><td style="padding:16px 32px 24px;border-top:1px solid #E5E1D8;">
  <p style="margin:0;font-size:12px;color:#94a3b8;">
    Finkley · management accounting for beauty salons
  </p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`,
}

const PRIVACY_ALERT_PL: EmailTemplate = {
  subject: '🔒 Administrator {{actor_name}} przejrzał kontakty {{client_count}}+ klientów',
  html: `<!DOCTYPE html>
<html lang="pl"><body style="margin:0;padding:0;background:#F7F4EE;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F7F4EE;padding:40px 16px;">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background:#fff;border-radius:12px;border:1px solid #E5E1D8;overflow:hidden;">
<tr><td style="padding:32px 32px 16px;">
  <p style="margin:0 0 8px 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#C9A24B;">Powiadomienie o prywatności</p>
  <h1 style="margin:0 0 12px 0;font-size:22px;line-height:28px;font-weight:800;color:#1A1A2E;">
    Administrator przejrzał kontakty {{client_count}}+ klientów
  </h1>
  <p style="margin:0 0 12px 0;font-size:15px;line-height:22px;color:#334155;">
    Dziś administrator <strong>{{actor_name}}</strong> otworzył listę klientów
    salonu <strong>{{salon_name}}</strong>, gdzie były widoczne dane kontaktowe
    ponad {{client_count}} klientów.
  </p>
  <p style="margin:0 0 12px 0;font-size:15px;line-height:22px;color:#334155;">
    To standardowe działanie dla roli „administrator" — ma pełny dostęp do bazy
    klientów domyślnie. Jeśli chcesz ukryć kontakty konkretnie przed tą osobą lub
    zmienić jej rolę na „mistrz" / „księgowy", przejdź do sekcji „Zespół"
    w ustawieniach salonu.
  </p>
  <p style="margin:24px 0;">
    <a href="{{team_url}}" style="display:inline-block;background:#1A1A2E;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;font-size:15px;">
      Otwórz sekcję „Zespół"
    </a>
  </p>
  <p style="margin:0;font-size:13px;color:#64748b;">
    To automatyczne powiadomienie przychodzi maksymalnie raz dziennie — nawet jeśli administrator otwierał listę wielokrotnie.
  </p>
</td></tr>
<tr><td style="padding:16px 32px 24px;border-top:1px solid #E5E1D8;">
  <p style="margin:0;font-size:12px;color:#94a3b8;">
    Finkley · księgowość zarządcza dla salonów kosmetycznych
  </p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`,
}

const BANK_CONSENT_EXPIRING_EN: EmailTemplate = {
  subject: "'{{bank_name}}' connection expires in {{days_left}} days",
  html: `<!DOCTYPE html>
<html lang="en"><body style="margin:0;padding:0;background:#F7F4EE;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F7F4EE;padding:40px 16px;">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background:#fff;border-radius:12px;border:1px solid #E5E1D8;overflow:hidden;">
<tr><td style="padding:32px 32px 16px;">
  <p style="margin:0 0 8px 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#C9A24B;">Action in {{days_left}} days</p>
  <h1 style="margin:0 0 12px 0;font-size:22px;line-height:28px;font-weight:800;color:#1A1A2E;">
    '{{bank_name}}' bank connection is about to expire
  </h1>
  <p style="margin:0 0 12px 0;font-size:15px;line-height:22px;color:#334155;">
    Per PSD2 rules, the bank requires you to personally re-authorize Finkley's
    access to transactions at least every 6 months. The current authorization for
    '{{bank_name}}' ({{salon_name}}) expires on <strong>{{valid_until}}</strong>.
  </p>
  <p style="margin:0 0 12px 0;font-size:15px;line-height:22px;color:#334155;">
    Without re-authorization — auto-import of expenses will stop. Nothing scary:
    transactions already pulled remain, you simply won't receive new ones. To
    continue, click the button and pass the bank's confirmation (30 seconds).
  </p>
  <p style="margin:24px 0;">
    <a href="{{reconnect_url}}" style="display:inline-block;background:#1A1A2E;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;font-size:15px;">
      Reconnect bank
    </a>
  </p>
  <p style="margin:0;font-size:13px;color:#64748b;">
    If you no longer use this bank — you can simply disconnect it in integration
    settings. Previously imported expenses will remain.
  </p>
</td></tr>
<tr><td style="padding:16px 32px 24px;border-top:1px solid #E5E1D8;">
  <p style="margin:0;font-size:12px;color:#94a3b8;">
    Finkley · management accounting for beauty salons
  </p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`,
}

const BANK_CONSENT_EXPIRING_PL: EmailTemplate = {
  subject: 'Połączenie z „{{bank_name}}" wygasa za {{days_left}} dni',
  html: `<!DOCTYPE html>
<html lang="pl"><body style="margin:0;padding:0;background:#F7F4EE;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F7F4EE;padding:40px 16px;">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background:#fff;border-radius:12px;border:1px solid #E5E1D8;overflow:hidden;">
<tr><td style="padding:32px 32px 16px;">
  <p style="margin:0 0 8px 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#C9A24B;">Akcja za {{days_left}} dni</p>
  <h1 style="margin:0 0 12px 0;font-size:22px;line-height:28px;font-weight:800;color:#1A1A2E;">
    Połączenie z bankiem „{{bank_name}}" wkrótce wygaśnie
  </h1>
  <p style="margin:0 0 12px 0;font-size:15px;line-height:22px;color:#334155;">
    Zgodnie z PSD2 bank wymaga, abyś osobiście potwierdzał dostęp Finkley do
    transakcji co najmniej raz na 6 miesięcy. Obecne potwierdzenie dla
    „{{bank_name}}" ({{salon_name}}) wygasa <strong>{{valid_until}}</strong>.
  </p>
  <p style="margin:0 0 12px 0;font-size:15px;line-height:22px;color:#334155;">
    Bez ponownego połączenia — auto-import wydatków się zatrzyma. Nie martw się:
    transakcje już pobrane pozostaną, po prostu nie będziesz otrzymywać nowych.
    Aby kontynuować, kliknij przycisk i przejdź potwierdzenie w banku (zajmie 30 sekund).
  </p>
  <p style="margin:24px 0;">
    <a href="{{reconnect_url}}" style="display:inline-block;background:#1A1A2E;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;font-size:15px;">
      Połącz bank ponownie
    </a>
  </p>
  <p style="margin:0;font-size:13px;color:#64748b;">
    Jeśli już nie korzystasz z tego banku — możesz po prostu go odłączyć w
    ustawieniach integracji. Wcześniej zaimportowane wydatki pozostaną.
  </p>
</td></tr>
<tr><td style="padding:16px 32px 24px;border-top:1px solid #E5E1D8;">
  <p style="margin:0;font-size:12px;color:#94a3b8;">
    Finkley · księgowość zarządcza dla salonów kosmetycznych
  </p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`,
}

const LOCALE_OVERRIDES: Record<EmailLocale, Partial<Record<TemplateAlias, EmailTemplate>>> = {
  ru: {}, // RU — основной набор в TEMPLATES
  en: {
    welcome: WELCOME_EN,
    team_invitation: TEAM_INVITATION_EN,
    weekly_digest: WEEKLY_DIGEST_EN,
    trial_ending: TRIAL_ENDING_EN,
    payment_succeeded: PAYMENT_SUCCEEDED_EN,
    payment_failed: PAYMENT_FAILED_EN,
    subscription_canceled: SUBSCRIPTION_CANCELED_EN,
    gdpr_export: GDPR_EXPORT_EN,
    privacy_alert: PRIVACY_ALERT_EN,
    bank_consent_expiring: BANK_CONSENT_EXPIRING_EN,
  },
  pl: {
    welcome: WELCOME_PL,
    team_invitation: TEAM_INVITATION_PL,
    weekly_digest: WEEKLY_DIGEST_PL,
    trial_ending: TRIAL_ENDING_PL,
    payment_succeeded: PAYMENT_SUCCEEDED_PL,
    payment_failed: PAYMENT_FAILED_PL,
    subscription_canceled: SUBSCRIPTION_CANCELED_PL,
    gdpr_export: GDPR_EXPORT_PL,
    privacy_alert: PRIVACY_ALERT_PL,
    bank_consent_expiring: BANK_CONSENT_EXPIRING_PL,
  },
}

export function normalizeEmailLocale(input: unknown): EmailLocale {
  if (typeof input !== 'string') return 'ru'
  const base = input.split('-')[0]?.toLowerCase()
  if (base === 'pl') return 'pl'
  if (base === 'en') return 'en'
  return 'ru'
}

/**
 * Возвращает шаблон с учётом локали; если для локали перевод не сделан, падает
 * обратно на RU. Так юзер всегда получит письмо, даже если EN/PL ещё не
 * переведён для конкретного alias.
 */
export function pickTemplate(alias: TemplateAlias, locale: EmailLocale): EmailTemplate {
  const localized = LOCALE_OVERRIDES[locale]?.[alias]
  return localized ?? TEMPLATES[alias]
}

/**
 * Простая `{{var}}` подстановка. Незаданные ключи заменяются пустой строкой.
 */
export function render(template: string, vars: Record<string, string | number | null>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const v = vars[key]
    return v === null || v === undefined ? '' : String(v)
  })
}
