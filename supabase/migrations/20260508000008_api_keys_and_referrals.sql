-- TASK-41 + TASK-42 — API keys и реферальная программа.

-- =============================================================================
-- API keys для собственных интеграций салона.
-- Храним только хэш ключа (sha256), сам ключ показываем юзеру один раз
-- при создании. Префикс «fnk_live_» для легкой идентификации в логах.
-- =============================================================================
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  name text not null,                     -- "My Zapier integration"
  key_prefix text not null,               -- первые 12 символов ключа (для UI)
  key_hash text not null,                 -- sha256 hex полного ключа
  scopes text[] not null default array['read'], -- 'read' | 'write'
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  unique (key_hash)
);

create index if not exists idx_api_keys_salon on public.api_keys(salon_id, created_at desc);

alter table public.api_keys enable row level security;

-- Только admin/owner салона видит ключи (без раскрытия hash)
create policy "api keys read by admin" on public.api_keys for select using (
  public.is_salon_admin(salon_id)
);

-- Создание/отзыв — admin/owner
create policy "api keys insert by admin" on public.api_keys for insert with check (
  public.is_salon_admin(salon_id) and created_by = auth.uid()
);

create policy "api keys update by admin" on public.api_keys for update using (
  public.is_salon_admin(salon_id)
);

grant select, insert, update on public.api_keys to authenticated;
grant all on public.api_keys to service_role;

-- =============================================================================
-- TASK-42 — Реферальная программа
--
-- Каждый юзер имеет уникальный код. Когда новый юзер при регистрации
-- вводит чей-то код — оба получают месяц бесплатно. Реализуется через
-- Stripe coupon (применяется при checkout) + tracking в этой таблице.
-- =============================================================================

create table if not exists public.referral_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  code text not null unique,
  created_at timestamptz not null default now()
);

alter table public.referral_codes enable row level security;

-- Юзер видит свой код
create policy "own referral code" on public.referral_codes for select using (
  user_id = auth.uid()
);

grant select on public.referral_codes to authenticated;
grant all on public.referral_codes to service_role;

-- Учёт фактических приглашений (кто кого пригласил, активирован ли бонус)
create table if not exists public.referral_uses (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references auth.users(id) on delete cascade,
  referred_user_id uuid not null references auth.users(id) on delete cascade,
  code text not null,
  created_at timestamptz not null default now(),
  activated_at timestamptz,           -- когда referred оплатил подписку
  unique (referred_user_id)            -- один юзер может быть приглашён только один раз
);

alter table public.referral_uses enable row level security;

create policy "referrer sees own uses" on public.referral_uses for select using (
  referrer_user_id = auth.uid()
);

grant select on public.referral_uses to authenticated;
grant all on public.referral_uses to service_role;

-- =============================================================================
-- Helper RPC: получить или создать свой реферальный код.
-- Код = base32(uuid) первые 8 символов uppercase, защита от коллизий
-- через retry в loop.
-- =============================================================================
create or replace function public.get_or_create_referral_code()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_code text;
  v_attempt int := 0;
begin
  if v_user is null then
    raise exception 'auth_required';
  end if;

  select code into v_code from public.referral_codes where user_id = v_user;
  if v_code is not null then
    return v_code;
  end if;

  -- Генерим уникальный код, до 5 попыток
  loop
    v_attempt := v_attempt + 1;
    -- Формат: 8 chars из upper-case ASCII без 0/O/1/I/L
    v_code := upper(
      replace(replace(replace(replace(replace(
        substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
        '0', '2'), 'o', 'X'), '1', 'Y'), 'i', 'Z'), 'l', 'W')
    );
    begin
      insert into public.referral_codes(user_id, code) values (v_user, v_code);
      return v_code;
    exception when unique_violation then
      if v_attempt > 5 then raise; end if;
    end;
  end loop;
end;
$$;

revoke all on function public.get_or_create_referral_code() from public, anon;
grant execute on function public.get_or_create_referral_code() to authenticated, service_role;

-- =============================================================================
-- RPC: применить реферальный код. Вызывается после signup, до первого
-- checkout. Записывает referral_uses, activated_at будет проставлен из
-- stripe-webhook при первом успешном платеже.
-- =============================================================================
create or replace function public.apply_referral_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_referrer uuid;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'auth_required');
  end if;

  select user_id into v_referrer from public.referral_codes
  where code = upper(p_code);

  if v_referrer is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end if;
  if v_referrer = v_user then
    return jsonb_build_object('ok', false, 'error', 'self_referral');
  end if;

  -- Уже использовал реферал?
  if exists (select 1 from public.referral_uses where referred_user_id = v_user) then
    return jsonb_build_object('ok', false, 'error', 'already_used');
  end if;

  insert into public.referral_uses(referrer_user_id, referred_user_id, code)
  values (v_referrer, v_user, upper(p_code));

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.apply_referral_code(text) from public, anon;
grant execute on function public.apply_referral_code(text) to authenticated, service_role;
