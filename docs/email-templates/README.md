# Email Templates

> **Источник истины** — `supabase/functions/send-email/templates.ts` (inline HTML
>
> - subject строки). HTML здесь — reference-копии для дизайн-ревью. При правке
>   синхронизировать обе.

Транзакционные письма отправляются через **Resend** (REST API
`https://api.resend.com/emails`). Resend выбран после подписания DPA в стадии 1
(Postmark был кандидатом, но Resend дешевле + лучше DX).

## Архитектура

Edge function `supabase/functions/send-email/index.ts` принимает
`{ template: alias, to, vars }`, рендерит HTML через простую `{{var}}`-подстановку
и отправляет в Resend. Resend Templates **не используются** — мы шлём
полный HTML inline с каждым запросом. Так проще: все шаблоны под git, нет
расхождений между Resend Dashboard и кодом.

## Алиасы шаблонов

| Алиас                   | Когда отправляется                             |
| ----------------------- | ---------------------------------------------- |
| `welcome`               | После подтверждения email при регистрации      |
| `trial_ending`          | За 3 дня до окончания триала (cron)            |
| `payment_succeeded`     | Stripe webhook `invoice.paid`                  |
| `payment_failed`        | Stripe webhook `invoice.payment_failed`        |
| `subscription_canceled` | Stripe webhook `customer.subscription.deleted` |
| `gdpr_export`           | После генерации ZIP-архива (`generate-export`) |
| `weekly_digest`         | Понедельник 9:00 (cron `send-weekly-digests`)  |
| `team_invitation`       | Приглашение в команду салона (TASK-38)         |

`email-confirmation`, `password-reset`, `magic-link` — обрабатываются дефолтными
шаблонами Supabase Auth (Auth → Email Templates в Dashboard), не через нашу
edge function. Их HTML тоже стоит брендировать — см. секцию ниже.

## Принципы

- **Plain text + минимальный HTML.** Не делаем «красивые» newsletter-шаблоны
  с фотографиями. Юзер открывает письмо и сразу видит что нужно.
- **Тон — на «ты», тёплый.** «Привет, Анна! Спасибо что попробовала Finkley…»
- **Подпись — реальное имя владельца.** Не «Команда Finkley». Юзеры доверяют
  живым людям.
- **CTA — одна, явная.** Кнопка с одним действием, не 5 ссылок в письме.
- **Отписка** для маркетинговых писем (`weekly_digest`) — обязательна по GDPR
  (есть toggle в Settings → «Еженедельный дайджест»). Для транзакционных
  (`billing`, `password-reset`, `gdpr_export`) — не нужна.

## Resend-переменные

В шаблоне используем `{{variable}}` синтаксис (свой простой рендерер, не
Mustache). Незаданные ключи заменяются пустой строкой.

Стандартные переменные доступны во всех шаблонах:

- `{{full_name}}` — имя пользователя из `profiles`
- `{{salon_name}}` — название салона (если в контексте салона)
- `{{app_url}}` — `https://finkley.app/app/`
- `{{owner_name}}` — имя владельца Finkley (для подписи)

Шаблон-специфичные переменные перечислены в HTML-комментарии в начале каждого
файла + в `templates.ts`.

## Шаблоны (исходники)

- [`welcome.html`](./welcome.html)
- [`trial-ending.html`](./trial-ending.html)
- [`payment-succeeded.html`](./payment-succeeded.html)
- [`payment-failed.html`](./payment-failed.html)
- [`subscription-canceled.html`](./subscription-canceled.html)
- [`gdpr-export.html`](./gdpr-export.html)
- [`weekly-digest.html`](./weekly-digest.html)
- [`team-invitation.html`](./team-invitation.html)

## Что нужно от владельца, чтобы письма пошли в продакшен

1. **Создать домен в Resend Dashboard** → Domains → Add domain → `finkley.app`.
   Resend выдаст 3 DNS-записи (DKIM ×2 + SPF). Добавить их у регистратора
   (мы пока на GitHub Pages, домен — Cloudflare/Namecheap/Reg.ru — зависит
   от того где куплен).
2. **Дождаться `Verified` статуса** в Resend (обычно 5–60 минут).
3. **Создать API key** в Resend → API Keys → Create → scope = «Sending access
   only». Скопировать.
4. **Добавить секрет** в Supabase: `supabase secrets set RESEND_API_KEY=re_xxx`
   (или через Dashboard → Project Settings → Edge Functions → Secrets).
5. **Проверить sender** в `send-email/index.ts` — `from` должен быть
   `Finkley <hello@finkley.app>` (имя на латинице, иначе спам-фильтры).
6. **DMARC-запись** (опционально, но снижает спам-рейт):
   `v=DMARC1; p=none; rua=mailto:dmarc@finkley.app` — пусть будет хотя бы
   `p=none` чтобы получать отчёты.

## Тестирование

Перед production обязательно:

1. **mail-tester.com** — отправить test email на их адрес → score ≥9/10.
   Проверяет DKIM/SPF/DMARC, спам-сигналы.
2. **Litmus / Email on Acid** (опц., платное) — превью в разных клиентах.
3. **Ручной test** — на свой Gmail, Outlook, Apple Mail.
4. **Inbox placement** — попадает ли письмо в Inbox или Promotions/Spam.

В Settings → «Еженедельный дайджест» есть кнопка «Отправить сейчас» — самый
простой smoke-test после настройки DNS.

## Чёрный список тем и фраз (антиспам)

❌ Не использовать в темах:

- ВЕРХНИЙ РЕГИСТР
- !!!
- «Бесплатно», «СКИДКА 50%», «АКЦИЯ»
- Цифры доллара «$15» (ставим € или PLN)
- «Срочно», «Не пропустите»

✅ Темы должны быть:

- Личными («Привет от Finkley»)
- Информативными («Твой триал заканчивается через 3 дня»)
- Без воскл.знаков (один максимум, и редко)

## Юр.адрес и подвал

Сейчас во всех шаблонах в подвале placeholder:
`Finkley · <юр.лицо>, <адрес>, Польша`. После регистрации ИП заменить на
реальный — это требование CAN-SPAM/GDPR (физический адрес отправителя).
Изменения нужно сделать в:

- `supabase/functions/send-email/templates.ts` (источник)
- `docs/email-templates/*.html` (синхронизация)

Подвал в идеале вынести в общий layout — пока продублирован в каждом шаблоне
для простоты, после первого ребрендинга вытащим.
