-- =============================================================================
-- 20260514230001_cleanup_test_data_orphans.sql
-- =============================================================================
-- Дополнение к 20260514230000_cleanup_test_data.sql: первая миграция использовала
-- session_replication_role=replica чтобы отключить триггеры, но это также
-- ОТКЛЮЧИЛО все FK-каскады. В результате остались orphan-rows в дочерних
-- таблицах (profiles без auth.users, visits/expenses/clients без salons, etc.).
--
-- Тут ручной cleanup всего что не привязано к реальным auth.users / salons.
-- На fresh DB — no-op (нет orphans).
-- =============================================================================

do $$
declare
  -- Все таблицы с salon_id FK (имена выясняются из information_schema)
  r record;
begin
  set local session_replication_role = replica;

  -- Profiles без auth.users
  delete from public.profiles p
    where not exists (select 1 from auth.users u where u.id = p.id);

  -- App admins без auth.users
  delete from public.app_admins a
    where not exists (select 1 from auth.users u where u.id = a.user_id);

  -- Salon members без salon ИЛИ без user
  delete from public.salon_members sm
   where not exists (select 1 from public.salons s where s.id = sm.salon_id)
      or not exists (select 1 from auth.users u where u.id = sm.user_id);

  -- Orphans во всех public-таблицах с salon_id-колонкой
  -- (динамически — чтобы не падать на таблицах которых нет в этой среде).
  for r in
    select c.table_schema, c.table_name
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.column_name = 'salon_id'
       and c.table_name not in ('salons','salon_members','salon_subscriptions','bug_reports')
  loop
    execute format(
      'delete from %I.%I t where t.salon_id is not null
         and not exists (select 1 from public.salons s where s.id = t.salon_id)',
      r.table_schema, r.table_name);
  end loop;

  -- salon_subscriptions orphan
  delete from public.salon_subscriptions ss
    where not exists (select 1 from public.salons s where s.id = ss.salon_id);

  -- audit_log без salon (после cascade — потенциально orphan)
  delete from public.audit_log al
    where al.salon_id is not null
      and not exists (select 1 from public.salons s where s.id = al.salon_id);

  -- Bug reports с reporter_user_id / salon_id на удалённых
  update public.bug_reports
     set reporter_user_id = null
   where reporter_user_id is not null
     and not exists (select 1 from auth.users u where u.id = reporter_user_id);
  update public.bug_reports
     set salon_id = null
   where salon_id is not null
     and not exists (select 1 from public.salons s where s.id = salon_id);

  set local session_replication_role = origin;
end$$;
