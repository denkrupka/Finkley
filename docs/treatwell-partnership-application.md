# Treatwell — заявка на интеграционное партнёрство

> Цель: получить **официальный** доступ к синхронизации броней/визитов из
> Treatwell Connect для салонов-клиентов Finkley — без скрейпинга и капчи.

## Почему это нужно (контекст)

Логин в Treatwell Connect защищён Cloudflare Turnstile. Серверный обход
(Capsolver / headless-браузер с датацентр-IP) **не работает** — токен капчи
привязан к IP, и Treatwell его отвергает (`NOT_VERIFIED_CAPTCHA`). Подтверждено
живыми тестами 07–08.06.2026. Надёжный путь — официальная интеграция, как у
Salonized / ClinicSoftware и др. партнёров Treatwell.

Доступ выдаётся **не** через публичный API-ключ, а через партнёрский договор:
флоу у партнёров — «Get Started → подписание контракта → активация».

## Куда писать

- Партнёрский портал / помощь: <https://partnercare.treatwell.com/>
- Страница для интеграторов ПО: <https://www.treatwell.co.uk/partners/integrated-softwares/>
  (CTA «find out how to get integrated»)
- Б2Б-партнёрства: через форму на <https://www.treatwell.co.uk/partners/> или
  напрямую в business development (формат почты Treatwell: `First.Last@treatwell.com`).
- Инженерный блог (для тех. контактов): <https://treatwell.engineering/tagged/api>

**Что заполнить владельцу перед отправкой** (плейсхолдеры `<…>` ниже):
объём салонов, страна/рынок, ссылка на продукт, контактное лицо.

---

## Черновик письма (EN — отправлять на английском)

> **Subject:** Integration partnership request — Finkley (salon financial management) × Treatwell Connect
>
> Hello Treatwell Partnerships team,
>
> I'm <NAME>, founder of **Finkley** (<https://finkley.app>), a financial
> management tool for hair & beauty salons in <COUNTRY/EU>. Finkley gives salon
> owners a single dashboard for revenue, expenses, payroll and profitability,
> pulling booking data from the platforms they already use.
>
> Several of our salons use **Treatwell Connect** and have asked us to reflect
> their Treatwell appointments and revenue inside Finkley. We'd like to do this
> **the right way — through an official integration**, rather than any
> unofficial method.
>
> We're looking for partner/API access to **read**, for salons that explicitly
> connect their account:
>
> - appointments / bookings (date, service, staff, price, status),
> - services menu, staff list, and customers.
>
> This is read-only reporting to power the salon's own financial dashboard — we
> don't resell data and we don't compete with Treatwell's booking marketplace;
> if anything, better financial visibility helps salons stay active on Treatwell.
>
> A few details about us:
>
> - Product: <SHORT DESCRIPTION>, live since <DATE>.
> - Salons onboarded / pipeline: <NUMBER>.
> - Markets: <e.g. Poland / EU>.
> - Tech: secure OAuth / API integration, encrypted credential storage,
>   GDPR-compliant (EU hosting, Supabase Frankfurt).
>
> Could you point me to the right process to become an integrated software
> partner, and share the technical documentation and terms? Happy to sign the
> standard partner agreement and complete any review.
>
> Thank you very much,
> <NAME>
> <ROLE>, Finkley — <EMAIL> — <PHONE/CALENDLY>

---

## Запасной путь, пока партнёрство оформляется

Импорт CSV уже работает в приложении (Settings → Импорт): салон выгружает
отчёт по визитам из Treatwell Connect и загружает файл — Finkley распознаёт
колонки (EN + de/fr/it/nl локали) и подтягивает визиты. Капча и API при этом
не нужны. См. `apps/web/src/lib/utils/csv-mapping.ts`.
