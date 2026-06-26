-- =============================================================================
-- 20260626000001_phone_verification.sql
-- =============================================================================
-- SMS-подтверждение номера телефона на шаге онбординга «Связь».
-- Юзер вводит телефон → получает SMS с 6-значным кодом → вводит код →
-- profiles.phone выставляется + profiles.phone_verified_at = now().
--
-- Принципы:
--   * Сами коды (хэш) живут в phone_verification_codes — DENY-ALL для anon/
--     authenticated, доступ ТОЛЬКО service_role (через edge function
--     phone-verify). Клиент НИКОГДА не читает код.
--   * Код хранится как SHA-256 хэш, не plaintext.
--   * Один активный код на юзера — каждый новый 'send' заменяет предыдущий.
--   * expires_at = now()+10min, attempts limit = 5 (enforced в edge function).
-- =============================================================================

-- ---- Колонка подтверждённости телефона в профиле ----
alter table public.profiles
  add column if not exists phone_verified_at timestamptz;

-- ---- Таблица одноразовых кодов подтверждения ----
create table if not exists public.phone_verification_codes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  phone       text not null,
  code_hash   text not null,
  expires_at  timestamptz not null default (now() + interval '10 minutes'),
  attempts    int not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists idx_phone_verification_codes_user
  on public.phone_verification_codes(user_id);

-- ---- RLS: deny-all для всех ролей кроме service_role ----
-- Включаем RLS и НЕ создаём ни одной policy для anon/authenticated →
-- они физически не видят ни одной строки. service_role обходит RLS.
alter table public.phone_verification_codes enable row level security;

-- Явно отзываем любые grants у anon/authenticated, выдаём только service_role.
revoke all on public.phone_verification_codes from anon, authenticated;
grant select, insert, update, delete on public.phone_verification_codes to service_role;
