-- Audit trigger functions из 20260508000007 — не должны быть доступны
-- через REST API (это trigger functions, вызываются Postgres-ом
-- автоматически). Revoke от anon/authenticated — только service_role
-- (и postgres для триггеров).
--
-- В реальности злоумышленник через анонимный POST /rest/v1/rpc/audit_*_change()
-- мало что мог бы — сами функции читают TG_OP и new/old (без аргументов),
-- так что вне триггера выбросят NULL pointer на TG_OP. Но грантуем минимум
-- по принципу least privilege.

revoke all on function public.audit_visits_change() from public, anon, authenticated;
revoke all on function public.audit_expenses_change() from public, anon, authenticated;
revoke all on function public.audit_members_change() from public, anon, authenticated;
revoke all on function public.audit_invitations_change() from public, anon, authenticated;
revoke all on function public.audit_salons_change() from public, anon, authenticated;
