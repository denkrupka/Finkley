-- =============================================================================
-- Fix create_telegram_link_code() — gen_random_bytes недоступна без pgcrypto
-- в search_path. Заменяем на gen_random_uuid() (всегда доступна в Supabase).
-- =============================================================================

create or replace function create_telegram_link_code()
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  v_code text;
  v_raw text;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  -- Чистим старое
  delete from telegram_link_codes
  where user_id = v_user_id
     or expires_at < now();

  -- Берём 8 символов из UUID (32 hex-знаков), upper-case.
  -- Энтропия 8 hex-знаков = 32 бита ≈ 4.3 млрд комбинаций → коллизии в
  -- 10-минутном TTL практически невозможны.
  v_raw := replace(gen_random_uuid()::text, '-', '');
  v_code := upper(substring(v_raw, 1, 8));

  insert into telegram_link_codes(code, user_id, expires_at)
  values (v_code, v_user_id, now() + interval '10 minutes');

  return v_code;
end;
$$;

revoke all on function create_telegram_link_code() from public;
grant execute on function create_telegram_link_code() to authenticated;
