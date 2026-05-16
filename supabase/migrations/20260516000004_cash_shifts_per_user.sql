-- ─────────────────────────────────────────────────────────────────────────────
-- 20260516000004_cash_shifts_per_user.sql
--
-- Каждый кассир теперь ведёт СВОЮ смену независимо от других. Один салон
-- может иметь несколько одновременно открытых смен — по одной на каждого
-- сотрудника. До этой миграции уникальный индекс позволял только одну
-- открытую смену на весь салон.
--
-- Также добавляем триггеры, которые автоматически проставляют `created_by`
-- = auth.uid() на новых визитах и расходах — без этого фильтрация
-- транзакций смены «только мои» работать не может.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Уникальность смены: теперь per-user, а не per-salon.
drop index if exists cash_shifts_one_open_per_salon;

create unique index if not exists cash_shifts_one_open_per_user_per_salon
  on cash_shifts(salon_id, opened_by_user_id)
  where status = 'open';

-- 2. Авто-заполнение created_by = auth.uid() для visits и expenses.
--
-- Раньше клиент явно не передавал created_by в insert, и поле оставалось
-- NULL. Из-за этого касса не могла привязать транзакцию к смене конкретного
-- кассира. Делаем это на стороне БД, чтобы не зависеть от поведения клиента.
--
-- SECURITY DEFINER чтобы триггер мог читать auth.uid() даже в RPC-контекстах
-- (через RLS оно доступно, но triggers иногда выполняются с другой ролью).

create or replace function set_created_by_from_auth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists set_visits_created_by on visits;
create trigger set_visits_created_by
  before insert on visits
  for each row execute function set_created_by_from_auth();

drop trigger if exists set_expenses_created_by on expenses;
create trigger set_expenses_created_by
  before insert on expenses
  for each row execute function set_created_by_from_auth();
