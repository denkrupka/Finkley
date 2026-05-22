-- =============================================================================
-- 20260523000001_sms_bonus_grants.sql
-- =============================================================================
-- Super-admin может начислять SMS-баланс салону без оплаты («bonus»).
-- Расширяем salon_sms_purchases новым status='bonus' и audit-полями
-- granted_by / granted_reason. UI: admin/salons → колонка «Баланс SMS» →
-- кнопка «+» → модалка с amount + reason.
-- =============================================================================

alter table public.salon_sms_purchases
  drop constraint if exists salon_sms_purchases_status_check;

alter table public.salon_sms_purchases
  add constraint salon_sms_purchases_status_check
  check (status in ('pending', 'paid', 'failed', 'refunded', 'bonus'));

-- Bonus-начисления не имеют цены, поэтому ослабляем check'и для status='bonus'.
alter table public.salon_sms_purchases
  drop constraint if exists salon_sms_purchases_price_per_sms_grosz_check;
alter table public.salon_sms_purchases
  add constraint salon_sms_purchases_price_per_sms_grosz_check
  check (price_per_sms_grosz >= 0);

alter table public.salon_sms_purchases
  drop constraint if exists salon_sms_purchases_total_grosz_check;
alter table public.salon_sms_purchases
  add constraint salon_sms_purchases_total_grosz_check
  check (total_grosz >= 0);

alter table public.salon_sms_purchases
  add column if not exists granted_by uuid references auth.users(id),
  add column if not exists granted_reason text;

comment on column public.salon_sms_purchases.granted_by is
  'Super-admin user_id если начисление сделано вручную через admin-stats (status=bonus).';
comment on column public.salon_sms_purchases.granted_reason is
  'Причина начисления bonus (комментарий админа для audit).';
