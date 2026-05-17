-- ─────────────────────────────────────────────────────────────────────────────
-- 20260518000001_cash_transfer_update_rpc.sql
--
-- RPC для редактирования существующего трансфера. RLS-политика на
-- cash_transfers разрешает UPDATE только `using (false)` — все правки идут
-- через SECURITY DEFINER функцию с проверками.
--
-- Запрещаем редактировать:
--   - soft-deleted (deleted_at IS NOT NULL)
--   - reversal-записи (reversal_of IS NOT NULL — это автоматический откат)
--
-- Роли: owner/admin того же салона.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.cash_transfer_update(
  p_id uuid,
  p_from_register_id text,
  p_to_register_id text,
  p_amount_cents bigint,
  p_comment text,
  p_transferred_at timestamptz
) returns public.cash_transfers
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_transfer public.cash_transfers;
  v_role text;
begin
  select * into v_transfer from public.cash_transfers where id = p_id;
  if not found then
    raise exception 'transfer_not_found' using errcode = 'P0002';
  end if;

  select role into v_role
    from public.salon_members
    where salon_id = v_transfer.salon_id
      and user_id = auth.uid();
  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception 'forbidden_only_owner_admin_can_edit_transfer' using errcode = '42501';
  end if;

  if v_transfer.deleted_at is not null then
    raise exception 'cannot_edit_deleted_transfer' using errcode = 'P0001';
  end if;
  if v_transfer.reversal_of is not null then
    raise exception 'cannot_edit_reversal_record' using errcode = 'P0001';
  end if;

  if p_from_register_id = p_to_register_id then
    raise exception 'from_and_to_must_differ' using errcode = 'P0001';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'amount_must_be_positive' using errcode = 'P0001';
  end if;

  update public.cash_transfers set
    from_register_id = p_from_register_id,
    to_register_id = p_to_register_id,
    amount_cents = p_amount_cents,
    comment = p_comment,
    transferred_at = p_transferred_at
  where id = p_id
  returning * into v_transfer;

  return v_transfer;
end;
$$;

revoke all on function public.cash_transfer_update(uuid, text, text, bigint, text, timestamptz)
  from public;
grant execute on function public.cash_transfer_update(uuid, text, text, bigint, text, timestamptz)
  to authenticated;

comment on function public.cash_transfer_update is
  'Редактирование cash_transfer. owner/admin того же салона. Запрет на правку '
  'soft-deleted и reversal-записей. Баланс «не уйти в минус» не валидируется '
  'на уровне RPC — это видно в кассовом отчёте, но сама запись пройдёт.';
