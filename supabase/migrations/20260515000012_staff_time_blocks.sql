-- =============================================================================
-- staff_time_blocks — блокировки времени мастера (резерв + отсутствие).
-- =============================================================================
-- Image #44: при клике на 15-мин субслот в календаре резерваций — выбор
-- между «Новый визит», «Резерв времени», «Отсутствие». Первое — это visit;
-- второе и третье — НЕ визиты, а просто блокировка слота мастера.
--
-- Блок отличается от visit тем, что не учитывается в выручке/отчётах,
-- но рендерится в календаре поверх ячеек мастера со штриховкой.
-- =============================================================================

create type staff_block_kind as enum ('reservation', 'absence');

create table if not exists public.staff_time_blocks (
  id          uuid primary key default gen_random_uuid(),
  salon_id    uuid not null references public.salons(id) on delete cascade,
  staff_id    uuid not null references public.staff(id) on delete cascade,
  kind        staff_block_kind not null,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  label       text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists idx_staff_blocks_staff_starts
  on public.staff_time_blocks(staff_id, starts_at);

create index if not exists idx_staff_blocks_salon_range
  on public.staff_time_blocks(salon_id, starts_at, ends_at);

alter table public.staff_time_blocks enable row level security;

create policy "staff_blocks_select" on public.staff_time_blocks
  for select using (
    exists (
      select 1 from public.salon_members sm
       where sm.salon_id = staff_time_blocks.salon_id
         and sm.user_id = auth.uid()
    )
  );

create policy "staff_blocks_insert" on public.staff_time_blocks
  for insert with check (
    exists (
      select 1 from public.salon_members sm
       where sm.salon_id = staff_time_blocks.salon_id
         and sm.user_id = auth.uid()
         and sm.role in ('owner', 'admin', 'accountant')
    )
  );

create policy "staff_blocks_update" on public.staff_time_blocks
  for update using (
    exists (
      select 1 from public.salon_members sm
       where sm.salon_id = staff_time_blocks.salon_id
         and sm.user_id = auth.uid()
         and sm.role in ('owner', 'admin', 'accountant')
    )
  );

create policy "staff_blocks_delete" on public.staff_time_blocks
  for delete using (
    exists (
      select 1 from public.salon_members sm
       where sm.salon_id = staff_time_blocks.salon_id
         and sm.user_id = auth.uid()
         and sm.role in ('owner', 'admin', 'accountant')
    )
  );

create or replace function public.tg_staff_blocks_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists trg_staff_blocks_updated_at on public.staff_time_blocks;
create trigger trg_staff_blocks_updated_at
  before update on public.staff_time_blocks
  for each row execute function public.tg_staff_blocks_set_updated_at();

comment on table public.staff_time_blocks is
  'Блокировки времени мастера: резерв слота под собственные дела или отсутствие/отпуск/больничный. Не учитываются в выручке. Используются календарём резерваций для штриховки занятых ячеек.';
