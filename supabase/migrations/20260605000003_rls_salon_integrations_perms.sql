-- =============================================================================
-- RLS на salon_integrations через has_perm.
--
-- salon_integrations содержит ЗАШИФРОВАННЫЕ credentials провайдеров (wFirma,
-- KSeF, Booksy, Banking, ...). Чтение credentials всё равно делается через
-- service_role в edge functions. Эта политика про SELECT/DELETE с клиента.
--
-- Категория: settings.integrations.{view,edit}.
--
-- Существующие "members read integration status" и "members can disconnect"
-- DROP'аются.
-- =============================================================================

drop policy if exists "members read integration status" on public.salon_integrations;
drop policy if exists "members can disconnect" on public.salon_integrations;

create policy "salon_integrations_select_perm" on public.salon_integrations
  for select using (
    public.has_perm(salon_id, 'settings', 'integrations', 'view')
  );

-- INSERT/UPDATE — практически всегда через service_role (edge functions).
-- Но добавляем edit-проверку для клиентского пути если когда-нибудь понадобится.
create policy "salon_integrations_insert_perm" on public.salon_integrations
  for insert with check (
    public.has_perm(salon_id, 'settings', 'integrations', 'edit')
  );

create policy "salon_integrations_update_perm" on public.salon_integrations
  for update using (
    public.has_perm(salon_id, 'settings', 'integrations', 'edit')
  ) with check (
    public.has_perm(salon_id, 'settings', 'integrations', 'edit')
  );

create policy "salon_integrations_delete_perm" on public.salon_integrations
  for delete using (
    public.has_perm(salon_id, 'settings', 'integrations', 'edit')
  );

comment on policy "salon_integrations_select_perm" on public.salon_integrations is
  'T36/GG — SELECT через has_perm(settings.integrations.view). Owner/admin всегда true.';
comment on policy "salon_integrations_delete_perm" on public.salon_integrations is
  'T36/GG — DELETE через has_perm(settings.integrations.edit). Owner/admin всегда true.';
