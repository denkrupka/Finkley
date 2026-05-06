# ADR-009: Telegram Login через custom edge function

## Статус

`Accepted` · 2026-05-05

## Контекст

Целевая аудитория Finkleyа — русскоязычные владелицы салонов в EU. Многие из них:

- Активно используют Telegram (часто как основной мессенджер)
- Не любят придумывать новые пароли
- Подозрительно относятся к незнакомым "входам через Google"

Telegram Login — это однокликовая аутентификация через Telegram-клиент пользователя. Для нашей ЦА это знакомый и доверительный паттерн.

**Проблема:** Supabase Auth не поддерживает Telegram нативно (только email, phone, и OAuth-провайдеры типа Google/GitHub). Нужно делать руками.

## Решение

**Custom edge function `telegram-auth`** + Supabase Auth admin API.

Процесс:

1. На странице `/login` — Telegram Login Widget (`telegram.org/js/telegram-widget.js`)
2. Юзер кликает → виджет авторизует через Telegram → возвращает данные (id, first_name, last_name, photo_url, auth_date, hash) на наш callback URL
3. Edge function `telegram-auth`:
   - Валидирует HMAC-подпись по `bot_token`
   - Проверяет, что `auth_date` не старше 5 минут
   - Ищет существующий profile по `telegram_id`
   - Если нет — создаёт через `supabase.auth.admin.createUser()` с fake email (`tg_{tg_id}@telegram.finkley.app`)
   - Сохраняет `telegram_id` в `profiles`
   - Через `supabase.auth.admin.generateLink({type: 'magiclink'})` получает session
   - Возвращает session клиенту, тот делает `supabase.auth.setSession()`

Подробности в `docs/09_INTEGRATIONS.md`.

## Альтернативы

- **Не делать Telegram Login.** Отклонено: владелец явно попросил, это часть стратегии для СНГ-аудитории.
- **Ждать, когда Supabase добавит Telegram нативно.** Их roadmap не показывает ETA.
- **Использовать стороннюю библиотеку (например, supabase-telegram-auth).** Отклонено: очередная зависимость, и проще написать ~100 строк своих чем дебажить чужое.

## Последствия

### Положительные

- Один-кликовый login для СНГ-юзеров
- Доверие через знакомый бренд (Telegram)
- Telegram-юзер сразу даёт нам `telegram_id`, в перспективе можем отправлять им уведомления через бота (стадия 4)

### Отрицательные

- Fake email (`tg_*@telegram.finkley.app`). **Проблема:** не можем отправить welcome письмо. **Митигация:** в onboarding-визарде шаг "укажите рабочий email" (опц.) с обещанием "пришлём важные уведомления и инвойсы".
- Custom код вместо стандартного Supabase Auth. **Митигация:** покрыть тестами edge function.
- Зависимость от Telegram (если их API меняется — мы ломаемся). **Митигация:** API stable годами, и если что — просто отключаем кнопку, остальные методы login работают.

### Что мониторим

- % юзеров, выбравших Telegram Login vs email/Google
- Возможные ошибки в HMAC-валидации (Sentry)
- Если конверсия из Telegram-аудитории низкая — пересмотреть UX
