-- Полный security sweep по SECURITY DEFINER функциям. По умолчанию Postgres
-- даёт EXECUTE через PUBLIC role, что в Supabase значит anon (public REST API
-- может вызвать). Revoke где не должны.
--
-- Принцип:
--  - cron / batch функции — только service_role
--  - trigger functions — никому через RPC не нужны
--  - юзер-функции (создание салона, выборка своих salons) — только authenticated

revoke all on function public.compute_benchmarks() from public, anon, authenticated;
revoke all on function public.process_recurring_expenses() from public, anon, authenticated;
revoke all on function public.process_weekly_insights() from public, anon, authenticated;

revoke all on function public.handle_new_user() from public, anon, authenticated;

revoke all on function public.create_salon_with_setup(text, text, text, text, text, text, jsonb, jsonb, text[]) from public, anon;
grant execute on function public.create_salon_with_setup(text, text, text, text, text, text, jsonb, jsonb, text[]) to authenticated, service_role;

revoke all on function public.user_admin_salon_ids() from public, anon;
grant execute on function public.user_admin_salon_ids() to authenticated, service_role;
