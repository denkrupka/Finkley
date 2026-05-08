# Email Templates

> **Источник истины** — `supabase/functions/send-email/templates.ts`. HTML здесь —
> reference-копии для дизайн-ревью. При правке синхронизировать обе.

Транзакционные письма отправляются через **Resend** (не Postmark — переехали в стадии 1
после подписания DPA, см. ADR-неизданный). Все на RU.

Алиасы шаблонов:

- `welcome` — после подтверждения email
- `trial-ending` — за 3 дня до конца триала
- `payment-succeeded` — после успешной оплаты
- `payment-failed` — при неудачной оплате
- `subscription-canceled` — после отмены
- `gdpr-export` — ZIP-архив пользовательских данных готов
- `weekly-digest` — еженедельный дайджест по понедельникам (KPI + AI-инсайт)
- `team-invitation` — приглашение в команду салона (стадия 5, TASK-38)

## Принципы

- **Plain text + минимальный HTML.** Не делаем "красивые" newsletter-шаблоны с фотографиями. Юзер открывает письмо и сразу видит что нужно.
- **Тон — на "ты", тёплый.** "Привет, Анна! Спасибо что попробовала Finkley..."
- **Подпись — реальное имя владельца.** Не "Команда Finkley". Юзеры доверяют живым людям.
- **CTA — одна, явная.** Кнопка с одним действием, не 5 ссылок в письме.
- **Отписка** для маркетинговых писем (weekly-digest) — обязательна по GDPR. Для транзакционных (billing, password-reset) — не нужна.

## Postmark переменные

В шаблоне используем `{{variable}}` синтаксис Mustache (Postmark default).

Стандартные переменные доступны во всех шаблонах:

- `{{full_name}}` — имя пользователя из profiles
- `{{salon_name}}` — название салона (если в контексте салона)
- `{{app_url}}` — `https://finkley.app`
- `{{support_email}}` — `support@finkley.app`
- `{{owner_name}}` — твоё имя (для подписи)

## Шаблоны

См. отдельные файлы:

- [`welcome.html`](./welcome.html)
- [`trial-ending.html`](./trial-ending.html)
- [`payment-succeeded.html`](./payment-succeeded.html)
- [`payment-failed.html`](./payment-failed.html)
- [`subscription-canceled.html`](./subscription-canceled.html)
- [`gdpr-export.html`](./gdpr-export.html)
- [`weekly-digest.html`](./weekly-digest.html)
- [`team-invitation.html`](./team-invitation.html)

**email-confirmation** и **password-reset** — обрабатываются дефолтными
шаблонами Supabase Auth (Auth → Email Templates в Dashboard), не через нашу
edge function.

## Как загружать в Postmark

1. Postmark Dashboard → Servers → Finkley Production → Templates
2. New Template → выбрать тип "Standard" (не Layout)
3. Alias: одно из имён выше
4. Subject — отдельное поле
5. HTML body — содержимое из файла
6. Test → Send test

## Layout

Postmark поддерживает Layouts — общую обёртку для всех писем (header, footer). Создаём один Layout `main-layout.html` и все шаблоны его наследуют. Это даёт:

- Единый header с логотипом
- Единый footer с контактами и физическим адресом юрлица (требование CAN-SPAM/GDPR)
- Минимум дублирования

## Тестирование

Перед production обязательно:

1. **mail-tester.com** — отправить test email на их адрес → score ≥9/10. Проверяет DKIM/SPF/DMARC, спам-сигналы.
2. **Litmus / Email on Acid** (опц., платное) — превью в разных клиентах
3. **Ручной test** — на свой Gmail, Outlook, Apple Mail
4. **Inbox placement** — попадает ли письмо в Inbox или Promotions/Spam

## Чёрный список тем и фраз

Чтобы не попасть в спам:

❌ Не использовать в темах:

- ВЕРХНИЙ РЕГИСТР
- !!!
- "Бесплатно", "СКИДКА 50%", "АКЦИЯ"
- Цифры доллара "$15"
- "Срочно", "Не пропустите"

✅ Темы должны быть:

- Личными ("Привет от Finkley")
- Информативными ("Твой триал заканчивается через 3 дня")
- Без воскл.знаков (один максимум, и редко)
