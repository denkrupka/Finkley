-- =============================================================================
-- 20260511000001_drop_ifirma_ksiegowosc360.sql
-- =============================================================================
-- Отмена iFirma и 360Księgowość интеграций (решение владельца 2026-05-11):
-- удаляем все ранее созданные cron jobs, trigger-таблицы, удаляем существующие
-- salon_integrations rows этих провайдеров.
--
-- Если миграции 20260510000009 (iFirma) или 20260510000010 (360Księgowość)
-- не применились — DROP IF EXISTS пройдёт мирно. Если применились на staging
-- — почистим за собой.
-- =============================================================================

-- Снимаем cron jobs (если есть)
do $$
begin
  if exists (select 1 from cron.job where jobname = 'ifirma-auto-sync') then
    perform cron.unschedule('ifirma-auto-sync');
  end if;
  if exists (select 1 from cron.job where jobname = 'ksiegowosc360-auto-sync') then
    perform cron.unschedule('ksiegowosc360-auto-sync');
  end if;
end$$;

-- Дропаем RPC функции
drop function if exists public.cron_run_ifirma_syncs() cascade;
drop function if exists public.cron_run_ksiegowosc360_syncs() cascade;

-- Дропаем trigger-таблицы
drop table if exists public.ifirma_sync_triggers cascade;
drop table if exists public.ksiegowosc360_sync_triggers cascade;

-- Удаляем salon_integrations этих провайдеров если кто-то успел подключиться
delete from public.salon_integrations where provider in ('ifirma', 'ksiegowosc360');

-- Очищаем расходы импортированные из этих порталов (если такие были на staging)
-- Soft-delete вместо truncate — данные легко восстановить если решение
-- передумаем; деаkтивируем дедуп ksef_id чтобы повторный импорт прошёл чисто.
update public.expenses
set deleted_at = now(),
    metadata = metadata || jsonb_build_object('deletion_reason', 'provider_removed_20260511')
where source in ('ifirma', 'ksiegowosc360') and deleted_at is null;
