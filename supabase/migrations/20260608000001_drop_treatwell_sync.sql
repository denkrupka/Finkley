-- Свёртывание серверного синка Treatwell (08.06.2026).
--
-- Причина: автоматический вход в Treatwell Connect невозможен — Cloudflare
-- Turnstile привязывает токен капчи к IP, серверный логин (Capsolver / headless
-- с датацентр-IP) отвергается (NOT_VERIFIED_CAPTCHA, подтверждено). Edge-функция
-- treatwell-proxy удалена; cron, который её дёргал, и rendezvous-таблица больше
-- не нужны. Treatwell теперь подключается через CSV-импорт (Settings → Импорт).
--
-- Откат cron-инфраструктуры из 20260601000005_treatwell_sync_cron.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'treatwell-auto-sync') then
    perform cron.unschedule('treatwell-auto-sync');
  end if;
end$$;

drop function if exists public.cron_run_treatwell_syncs();

drop table if exists public.treatwell_sync_triggers;
