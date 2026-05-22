-- =============================================================================
-- 20260522000005_sender_checkout_url_60m.sql
-- =============================================================================
-- Юзеру нужно повторно открыть Stripe Checkout если он случайно закрыл
-- вкладку. Сохраняем URL в salon_sms_senders → UI показывает кнопку
-- «Открыть оплату».
--
-- Также: таймаут с 24h → 60 мин. Логика: Stripe Checkout сессии живут
-- 24ч после создания, но юзер обычно решает оплатить в первые минуты.
-- Если за час не оплатил — скорее всего передумал; запись очищаем,
-- освобождая sender_name для повторной покупки.
-- =============================================================================

alter table public.salon_sms_senders
  add column if not exists stripe_checkout_url text;

comment on column public.salon_sms_senders.stripe_checkout_url is
  'Stripe Checkout URL для повторного открытия оплаты. NULL после оплаты или отмены.';

create or replace function public.cancel_stale_pending_senders()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update public.salon_sms_senders
     set status = 'rejected',
         rejection_reason = 'payment_timeout (no Stripe checkout completed within 60 min)'
   where status = 'pending_payment'
     and age(now(), created_at) > interval '60 minutes';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
