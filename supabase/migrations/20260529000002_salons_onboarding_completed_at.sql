-- ADR-030 — Early-create salon в онбординге создаёт «brown» салоны:
-- если юзер бросил онбординг между Step "salon" и финальным submit,
-- в БД остаётся salon с пустыми staff/services/expense_categories.
-- Добавляем флаг onboarding_completed_at чтобы:
--   1. UI мог отличить «полноценный» салон от заброшенного (фильтр в
--      /salons + RootRedirect для useMySalons).
--   2. Cleanup-cron мог удалить заброшенные >7 дней.

alter table public.salons
  add column if not exists onboarding_completed_at timestamptz;

comment on column public.salons.onboarding_completed_at is
  'Timestamp когда юзер дошёл до финального submit() в онбординге. '
  'NULL = early-created salon, может быть заброшен. ADR-030.';

-- Бэкфилл для существующих салонов: считаем что они «завершены» (созданы
-- до early-create flow по старому RPC из финального submit).
update public.salons
  set onboarding_completed_at = created_at
  where onboarding_completed_at is null;

-- Индекс для cleanup-cron (где-то висит daily job который смотрит на
-- старые brown салоны).
create index if not exists salons_brown_idx
  on public.salons (created_at)
  where onboarding_completed_at is null;
