# DNS-записи для finkley.app (Cloudflare)

## Уже настроено и работает (verified)

### Resend — отправка писем

| Type | Name                | Value                                                                                                                                                                                                                        | Status             |
| ---- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| TXT  | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDQ0evCCOytnM1i78+zVV7x3WApcO8UBqhBDeg6E526VjTzMYIdisL6Fb+fj0AjIWqPMn+liliSId+l7RC49JK/Xce4BLuOnKpEzkckpL6EnxI9Qei0+8Z+yEyMiXLv6ipj+aO6Z9rS5sgDgMYg3bBKCdkD+RngOMsU67lvxjDtlQIDAQAB` | ✅ verified (DKIM) |
| MX   | `send`              | `feedback-smtp.eu-west-1.amazonses.com` (priority 10)                                                                                                                                                                        | ✅ verified        |
| TXT  | `send`              | `v=spf1 include:amazonses.com ~all`                                                                                                                                                                                          | ✅ verified (SPF)  |

## Рекомендуется добавить

### DMARC — лучшая доставляемость

Cloudflare → DNS → Add record:

| Type | Name     | Value                                                                                                          | TTL  |
| ---- | -------- | -------------------------------------------------------------------------------------------------------------- | ---- |
| TXT  | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@finkley.app; ruf=mailto:dmarc@finkley.app; aspf=r; adkim=r; sp=none; fo=1` | Auto |

**Пояснение:**

- `p=none` — не блокировать письма, только мониторить (рекомендованный старт). После 1-2 недель отчётов и проверки что всё OK можно повысить до `p=quarantine` или `p=reject`.
- `rua=mailto:dmarc@finkley.app` — куда слать агрегированные отчёты. Создай простой алиас `dmarc@finkley.app` → твой основной email; или используй сторонний сервис типа [dmarcian](https://dmarcian.com) (free tier).
- `aspf=r; adkim=r` — relaxed alignment, чтобы поддомены типа `email.finkley.app` тоже работали.
- `sp=none` — субдомены наследуют политику.
- `fo=1` — детальные отчёты при любом fail.

После добавления — проверить через [mxtoolbox.com/DMARCcheck.aspx](https://mxtoolbox.com/DMARCcheck.aspx) (5–30 мин propagation).

### MX для receiving (если будем принимать почту на info@finkley.app)

Сейчас не настроено — это нужно если ты хочешь чтобы `info@finkley.app` принимал входящую почту. Cloudflare Email Routing — бесплатный, форвардит на Gmail.

Cloudflare → Email → Email Routing → Get started → Add address `info@finkley.app` → forward to `deniskrupka001@gmail.com`. Cloudflare сам пропишет MX-записи + SPF.

## Уже работает на основном домене

GitHub Pages CNAME — управляется отдельно через `apps/web/public/CNAME` и `apps/landing/public/CNAME` (если он есть).

## Проверка после изменений

```
dig TXT _dmarc.finkley.app +short
dig TXT resend._domainkey.finkley.app +short
dig MX send.finkley.app +short
```

Или web: `https://mxtoolbox.com/SuperTool.aspx?action=mx%3afinkley.app&run=toolpage`
