-- =============================================================================
-- telegram_link_codes — одноразовые коды для привязки Telegram через deep-link.
-- =============================================================================
-- Проблема: Telegram Login Widget не отображается у части пользователей
-- (AdBlock режет telegram.org/js или у бота не задан /setdomain в BotFather).
-- Решение: пользователь жмёт «Привязать через бота» → frontend дёргает
-- create_telegram_link_code() → получает 8-символьный токен → открывает
-- t.me/<bug_bot>?start=link_<токен>. Бот видит /start link_<токен>,
-- ищет код в telegram_link_codes, делает profiles.telegram_id = sender_id
-- и удаляет код. ТТЛ — 10 минут.
-- =============================================================================

create table if not exists telegram_link_codes (
  code text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create index if not exists telegram_link_codes_user_idx on telegram_link_codes(user_id);
create index if not exists telegram_link_codes_expires_idx on telegram_link_codes(expires_at);

alter table telegram_link_codes enable row level security;

-- Никто из клиентов не должен читать/писать напрямую. Только RPC.
-- Поэтому policy не создаём — RLS блокирует всё.

-- RPC для создания кода. Вызывается из SPA с user JWT.
-- Удаляет старые/просроченные коды этого юзера перед созданием нового,
-- чтобы не копились мусорные строки (юзер может многократно жмакать).
create or replace function create_telegram_link_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_code text;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  -- Чистим старое
  delete from telegram_link_codes
  where user_id = v_user_id
     or expires_at < now();

  -- Генерация: 8 символов из base32-alphabet (без 0/O/1/I для читаемости).
  -- 32^8 ≈ 1.1e12 — коллизии практически невозможны при ttl 10 мин.
  v_code := upper(substring(
    translate(
      encode(gen_random_bytes(8), 'base64'),
      '+/=0OoIl1',
      'ABCDEFGHJ'
    ),
    1, 8
  ));

  insert into telegram_link_codes(code, user_id, expires_at)
  values (v_code, v_user_id, now() + interval '10 minutes');

  return v_code;
end;
$$;

revoke all on function create_telegram_link_code() from public;
grant execute on function create_telegram_link_code() to authenticated;

comment on table telegram_link_codes is
  'Одноразовые коды (TTL 10 мин) для deep-link привязки Telegram. Защита от AdBlock-блокировки Telegram Login Widget. См. supabase/functions/telegram-bug-collector — handler /start link_<code>.';
