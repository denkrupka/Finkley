-- =============================================================================
-- 20260514160000_app_admins_is_super.sql
-- =============================================================================
-- Q10: deniskrupka001@gmail.com — единственный super-admin, защищён от удаления,
-- блокировки и понижения роли. Полную RBAC-логику (RPC grant/revoke admin,
-- защита в delete_user etc.) делает следующая миграция (PR5).
--
-- Здесь только: новая колонка is_super + автопометка владельца, если он уже
-- есть в app_admins.
-- =============================================================================

alter table public.app_admins
  add column if not exists is_super boolean not null default false;

-- Единственная super-admin запись в системе (на данный момент): владелец.
update public.app_admins a
   set is_super = true
  from auth.users u
 where a.user_id = u.id
   and u.email = 'deniskrupka001@gmail.com';

-- Гарантируем что super-admin запись существует, если владелец уже создал юзера
insert into public.app_admins (user_id, is_super)
select u.id, true
  from auth.users u
 where u.email = 'deniskrupka001@gmail.com'
   and not exists (select 1 from public.app_admins where user_id = u.id);
