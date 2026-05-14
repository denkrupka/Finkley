-- =============================================================================
-- 20260515000003_digest_channels.sql
-- =============================================================================
-- TASK image #33: владельцу нужны несколько каналов доставки дайджеста
-- (email + Telegram). Раньше было одно поле `weekly_digest_enabled boolean` —
-- расширяем до массива каналов. *_enabled остаётся как master-switch
-- (derived = есть ли хоть один канал), edge functions начнут читать channels.
-- =============================================================================

alter table public.salons
  add column if not exists weekly_digest_channels text[] not null default array['email']::text[],
  add column if not exists daily_digest_channels  text[] not null default array['email']::text[];

-- Backfill: если *_enabled=true но channels пуст (например после backup-restore) —
-- ставим ['email'] чтобы не сломать существующую доставку.
update public.salons
   set weekly_digest_channels = array['email']::text[]
 where weekly_digest_enabled = true
   and (weekly_digest_channels is null or cardinality(weekly_digest_channels) = 0);

update public.salons
   set daily_digest_channels = array['email']::text[]
 where daily_digest_enabled = true
   and (daily_digest_channels is null or cardinality(daily_digest_channels) = 0);

-- Если *_enabled=false — пустой массив (никаких каналов).
update public.salons
   set weekly_digest_channels = array[]::text[]
 where weekly_digest_enabled = false;
update public.salons
   set daily_digest_channels = array[]::text[]
 where daily_digest_enabled = false;

-- Ограничение: значения только из {email, telegram}.
alter table public.salons
  drop constraint if exists salons_weekly_digest_channels_valid;
alter table public.salons
  add constraint salons_weekly_digest_channels_valid
  check (weekly_digest_channels <@ array['email','telegram']::text[]);

alter table public.salons
  drop constraint if exists salons_daily_digest_channels_valid;
alter table public.salons
  add constraint salons_daily_digest_channels_valid
  check (daily_digest_channels <@ array['email','telegram']::text[]);

comment on column public.salons.weekly_digest_channels is
  'Каналы доставки еженедельного дайджеста: подмножество {email, telegram}. Пустой = digest выключен.';
comment on column public.salons.daily_digest_channels is
  'Каналы доставки ежедневной сводки: подмножество {email, telegram}. Пустой = digest выключен.';
