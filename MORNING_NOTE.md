# MORNING NOTE — ночь 20→21 мая 2026

## ✅ Сделано и задеплоено

### Booksy интеграция

- **Длительность визитов** — из `booked_till - booked_from` (раньше всегда 60 мин).
- **«Rezerwacja czasu»** — резервы мастеров импортируются как штрихованные блоки.
- **Кнопка «Синхронизировать»** + автосинк при смене дня в календаре (debounce 600мс).
- **Reverse-sync create/delete визитов и блоков**: портал ↔ Booksy. Cancel через `POST /appointments/{uid}/action/`.
- **Move в Booksy** → обновляется в портале (раньше ignoreDuplicates пропускал).
- **Paid/Pending** — по `basket_id` в Booksy appointment, pending→paid апгрейд на sync.
- **Portal-owned reservations** не импортируются обратно, cancelled (status=C) пропускаются.

### KSeF

- **Подключение работает** — фикс ISO timestamp + async auth polling.
- **Invoice query shape** — `subjectType` + `dateRange` на корне body. Новые поля `ksefNumber`, `seller.nip`, `grossAmount`.
- **E2E проверено** с твоим токеном (NIP 7831854263) — 12+ фактур заносятся в expenses.

### Отчёты

- **ДДС**: только paid визиты + actual expenses. Pending не попадают.
- **Фин-отчёт plan/fact**:
  - План = все визиты (paid+pending) + expenses + scheduled_payments.
  - Факт = только paid + expenses.
  - Строка «Расходы» наконец показывает реальные суммы из БД.
- **P&L «Способы оплаты»** — лейблы из маппинга касс. «Конверт→cash» = строка «Конверт» вместо «Наличные».

### Кассы

- Колонка **«Тип средств»** (Наличные / Безналичные) с авто-эвристикой по названию.
- Колонка **«Маппинг оплаты»** — один payment_method на кассу (cash / card / transfer / online), уникальность через UI. Используется в P&L breakdown.

### Уведомления

- **Подвкладки «Каналы» / «Типы»** в Settings → Уведомления.
- Каналы: push, email/telegram для Еженедельного и Ежедневного дайджеста.
- Типы: чек-лист 10 типов с группировкой (Сводки / Платежи / События салона). Хранится в `salons.notification_prefs` jsonb.
- **Cron уведомлений о платежах** (`payment-reminders` edge function + pg_cron 08:00 UTC ежедневно): bucket'ы 2д/1д/сегодня/просрочка → Telegram + Email через Resend. Просроченные шлются каждый день пока не paid.

### Google / Apple Calendar

- Расширил существующий `calendar-feed` (RFC 5545 ICS). Role-based:
  - Owner/admin → все визиты + платежи из платёжного календаря (с VALARM за 24ч).
  - Мастер → только свои визиты.
- Использует `visits.duration_min` для DTEND (раньше всегда +60 мин).
- Подписка по URL из Settings → Календарь. Google Calendar / Apple Calendar / Outlook нативно.

### Conflict-check

- Игнорирует soft-deleted визиты (раньше «у мастера уже есть визит» вылезало после удаления).

### Лендинг finkley.app

- Главная: 15 фич (вместо 6), секция «Сколько часов вернёшь» (~15-20ч/мес), 11 интеграций, 12 отчётов.

### SPA stability

- **Stale-chunk reload** очищает caches + unregister SW → больше не залипает «Что-то сломалось» после деплоя.
- **404 для navigation** — SW возвращает cached APP_SHELL вместо 404.
- **CSP** — добавлен `static.cloudflareinsights.com`.

### i18n

- 1735 ключей RU → EN, 1731 → PL (как заглушки). Лучше fallback на raw-key — юзер видит русский на en/pl.
- Сверху руками переведены 33 критичных ключа сессии (notifications, cash mapping, sync кнопка, reservation modal).

## ⚠ Что важно протестировать первым делом

1. **Hard reload** (Ctrl+Shift+R) — старый SW обновится.
2. **KSeF**: «Подключить» с твоим токеном. Потом «Синхронизировать» — должны прилететь фактуры.
3. **Booksy paid статус**: Sync → визиты с зелёным $ в Booksy станут «оплачено».
4. **Move в Booksy** → перенос дня → portal обновится.
5. **Финансовый отчёт** → Финансы → Финансовый отчёт. В Расходах числа.
6. **ДДС** → только paid визиты.
7. **Settings → Уведомления → Типы**: чек-лист, можно отключать.
8. **Settings → Кассы → колонка «Маппинг оплаты»**: выбери для «Конверт» = cash, для «Bank/Karta» = card. Тогда в P&L «Способы оплаты» лейблы превратятся в имена касс.
9. **Settings → Календарь**: скопируй URL подписки, добавь в Google Calendar — увидишь визиты + платежи (для admin).

## 🐛 Известные ограничения

- **Legacy визиты/блоки** созданные до фикса с `external_reservation_id=null` — их удаление в портале не каскадит в Booksy. Один раз убери в Booksy руками.
- **Push для платёжных reminders** не реализован — пока Email (Resend) + Telegram. Push требует VAPID-helper рефактор `send-push`.
- **i18n EN/PL** — 1735 заглушек на русском. Профессиональный перевод оставшихся ключей — отдельной партией.
- **RESEND_API_KEY** должен быть настроен в Supabase env, иначе email напоминания пропускаются (silent fail).

## Все коммиты ночи (по порядку, новые → старые)

```
d52197f i18n: синхр ключей RU → EN/PL + перевод 33 критичных
4665d9d feat(calendar-feed): role-based фильтр + платежи
b8306d8 feat(notifications): cron уведомлений о платежах
eb6934a feat(settings): уведомления — Каналы/Типы вкладки
e47a777 feat(reports): P&L Способы оплаты — лейблы из маппинга касс
f13f704 feat(settings): кассы — Маппинг оплаты колонка
01ea88d docs(landing): главная — фичи, экономия, отчёты, интеграции
a9050ce docs: MORNING_NOTE
a044df7 fix(reports): expenses_total — реальные расходы
625fa73 fix(spa): stale-chunk reload + caches + SW unregister
fbcf8f4 fix(spa): SW отдаёт cached shell вместо 404
59a490e feat(settings): тип кассы Наличные/Безналичные
79d68c9 fix(booksy): pending→paid upgrade при sync
2c5c855 fix(booksy): move обновляет портал + delete cascade
b6341d9 fix(booksy): paid status по basket_id
b2a5717 fix(visits): conflict-check игнорирует soft-deleted
2b39ebd fix(ksef): invoices/query/metadata — новый shape
7e2f01c fix(ksef): challenge timestamp ISO + async polling
c00f552 fix(reports): ДДС/Фин-отчёт — только фактические
a2a839e fix(booksy): external_reservation_id на визите
f1abbf5 feat(booksy): delete визита → delete reservation
8992683 fix(booksy): не импортировать portal-owned резервации
e1f7cfa fix(booksy): не-partial unique index staff_time_blocks
bc36770 fix(booksy): резервы из /calendar + fallback
442f7c0 feat(booksy): day-sync кнопка + auto на смене дня
0e139d5 feat(booksy): reverse-delete пропавших
9be6e69 chore: prettier
0d3efca fix(booksy): syncClients renamed loader
c68fdc3 feat(booksy): длительность визитов + резервы времени
```
