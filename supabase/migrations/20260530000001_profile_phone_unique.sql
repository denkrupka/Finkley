-- Уникальность profiles.phone — один номер один аккаунт.
-- Частичный индекс: NULL и пустая строка не участвуют в уникальности
-- (мы не хотим блокировать юзеров без телефона).

-- Если уже есть дубли — конфликтующий index не создастся; вычищать
-- руками через admin tools. Здесь делаем permissive: пишем notice
-- и выходим если дубли обнаружены.

do $$
declare
  v_dupes int;
begin
  select count(*) into v_dupes from (
    select phone from public.profiles
    where phone is not null and phone <> ''
    group by phone having count(*) > 1
  ) d;
  if v_dupes > 0 then
    raise notice 'profiles.phone has % duplicates — unique index NOT created. Clean up first.', v_dupes;
    return;
  end if;
  create unique index if not exists profiles_phone_unique_idx
    on public.profiles(phone)
    where phone is not null and phone <> '';
end$$;

-- RPC для frontend-проверки до save: вернёт true если телефон занят
-- ДРУГИМ юзером (auth.uid() игнорирует свой собственный, чтобы edit
-- профиля не падал).
create or replace function public.check_phone_taken(p_phone text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where phone = p_phone
      and phone is not null
      and phone <> ''
      and id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
  );
$$;

revoke all on function public.check_phone_taken(text) from public;
grant execute on function public.check_phone_taken(text) to authenticated;

comment on function public.check_phone_taken(text) is
  'Возвращает true если phone уже занят другим юзером. Свой собственный '
  'телефон не считается занятым (для edit-профиля).';
