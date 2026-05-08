# DNS-записи для finkley.app (Cloudflare)

## Уже настроено и работает (verified)

### Resend — отправка писем

| Type | Name                | Value                                                                                                                                                                                                                        | Status             |
| ---- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| TXT  | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDQ0evCCOytnM1i78+zVV7x3WApcO8UBqhBDeg6E526VjTzMYIdisL6Fb+fj0AjIWqPMn+liliSId+l7RC49JK/Xce4BLuOnKpEzkckpL6EnxI9Qei0+8Z+yEyMiXLv6ipj+aO6Z9rS5sgDgMYg3bBKCdkD+RngOMsU67lvxjDtlQIDAQAB` | ✅ verified (DKIM) |
| MX   | `send`              | `feedback-smtp.eu-west-1.amazonses.com` (priority 10)                                                                                                                                                                        | ✅ verified        |
| TXT  | `send`              | `v=spf1 include:amazonses.com ~all`                                                                                                                                                                                          | ✅ verified (SPF)  |

### DMARC — уже настроен через Cloudflare DMARC Management

| Type | Name     | Value                                                                                                                                           |
| ---- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| TXT  | `_dmarc` | `v=DMARC1; p=none; rua=mailto:b3b22d4c8ebd465bb5ee0a580655b439@dmarc-reports.cloudflare.net, mailto:info@finkley.app; pct=100; aspf=r; adkim=r` |

Запись поставил Cloudflare через свой DMARC Management — отчёты падают и в Cloudflare-агрегатор (бесплатно), и копией на `info@finkley.app`.

**Что можно сделать через 2–3 недели мониторинга**, когда отчёты покажут что все наши потоки (Resend + Cloudflare Email Routing) проходят DMARC alignment: поднять политику с `p=none` на `p=quarantine` или `p=reject` — Cloudflare → Email Security → DMARC Management → пара кликов.

### Cloudflare Email Routing (входящая на `info@finkley.app`)

Уже настроено — есть DKIM-селектор `cf2024-1._domainkey` и SPF `v=spf1 include:_spf.mx.cloudflare.net ~all` на корневом домене. Forward'ит входящую почту на основной email.

### Дополнительно живут в DNS

- `google-site-verification=…` (Search Console) — оставлять
- `20260506190714pm._domainkey` — ещё один DKIM-селектор (видимо от прошлого почтового провайдера). Если нигде не используется — можно удалить, но не критично.

## Уже работает на основном домене

GitHub Pages CNAME — управляется отдельно через `apps/web/public/CNAME` и `apps/landing/public/CNAME` (если он есть).

## Проверка после изменений

```
dig TXT _dmarc.finkley.app +short
dig TXT resend._domainkey.finkley.app +short
dig MX send.finkley.app +short
```

Или web: `https://mxtoolbox.com/SuperTool.aspx?action=mx%3afinkley.app&run=toolpage`
