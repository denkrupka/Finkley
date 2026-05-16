-- ─────────────────────────────────────────────────────────────────────────────
-- 20260516000006_cash_shifts_auto_close.sql
--
-- Авто-закрытие зависших смен. Если кассир забыл закрыть смену в конце
-- дня, она висит открытой → завтра он не сможет открыть новую (уникальный
-- индекс «одна открытая на юзера»). Запускаем pg_cron каждые 15 минут:
-- любая смена старше 24 часов автоматически помечается closed с пометкой
-- discrepancy_reason = '[auto-close] Смена не закрыта в течение 24 часов'.
--
-- Сверка факта не делается (мы не знаем сколько было физически в кассе),
-- поэтому actual_cash/card_cents остаются NULL → diff не считается.
-- Юзеру в Кассе → История смены будет видно auto-close с комментарием.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function auto_close_stale_shifts()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update cash_shifts
  set
    status = 'closed',
    closed_at = now(),
    discrepancy_reason = coalesce(
      discrepancy_reason,
      '[auto-close] Смена не закрыта в течение 24 часов'
    )
  where status = 'open'
    and opened_at < (now() - interval '24 hours');
end;
$$;

-- Cron: каждые 15 минут проверяем висящие смены. Запускается через pg_cron
-- extension (стандартный для Supabase). Если extension не установлен —
-- ниже просто no-op без ошибок (DO BLOCK + IF EXISTS).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Удалим старый job если был (на случай повторной миграции).
    perform cron.unschedule(jobid)
      from cron.job
      where jobname = 'auto_close_stale_shifts';
    -- Schedule: каждые 15 минут.
    perform cron.schedule(
      'auto_close_stale_shifts',
      '*/15 * * * *',
      $cron$select public.auto_close_stale_shifts()$cron$
    );
  end if;
end
$$;
