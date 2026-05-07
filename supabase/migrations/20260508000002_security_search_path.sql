-- Security hardening: SECURITY DEFINER функции должны иметь явный search_path,
-- иначе атакующий с правами CREATE на public схеме может подменить
-- разрешение имён через свой trojan-объект (CVE-style "search-path injection").
--
-- Аудит выявил одну такую функцию — handle_new_user (trigger на auth.users
-- INSERT, создающий профиль). Фиксируем search_path = public, pg_temp.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$;
