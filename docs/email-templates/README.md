# Email Templates

Шаблоны транзакционных писем для Postmark. Все на RU. Загружать в Postmark Templates с alias-ами:

- `welcome` — после подтверждения email
- `email-confirmation` — для Supabase Auth confirm (заменяем дефолт)
- `password-reset` — для Supabase Auth reset
- `trial-ending` — за 3 дня до конца триала
- `payment-succeeded` — после успешной оплаты
- `payment-failed` — при неудачной оплате
- `subscription-canceled` — после отмены
- `weekly-digest` — еженедельный дайджест (стадия 4)

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
- `{{app_url}}` — `https://finkley.eu`
- `{{support_email}}` — `support@finkley.eu`
- `{{owner_name}}` — твоё имя (для подписи)

## Шаблоны

См. отдельные файлы:

- [`welcome.html`](./welcome.html)
- [`email-confirmation.html`](./email-confirmation.html)
- [`password-reset.html`](./password-reset.html)
- [`trial-ending.html`](./trial-ending.html)
- [`payment-succeeded.html`](./payment-succeeded.html)
- [`payment-failed.html`](./payment-failed.html)
- [`subscription-canceled.html`](./subscription-canceled.html)

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
