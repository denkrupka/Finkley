-- Backfill counterparty для уже синхронизированных bank_transactions.
-- В banking-sync extract'ор работает только для новых транзакций; старые
-- записи остались без counterparty. Эта функция применяет ту же эвристику
-- на стороне Postgres и возвращает количество обновлённых строк.
--
-- Логика (упрощённый порт из supabase/functions/banking-sync/index.ts):
--   1) Leading UPPERCASE words (минимум 2 буквы) до geo-noise (POZNAN/POL/...)
--   2) Pattern «домен-like» (APPLE.COM)
--   3) Pattern «слово с заглавной» — длина >= 4 (Revolut, Enea)
--
-- Безопасность: RLS отключаем через SECURITY DEFINER + проверка salon_id
-- (юзер должен быть owner салона).
create or replace function public.extract_bank_tx_counterparty(p_salon_id uuid)
returns table(updated_count bigint, total_with_null bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total bigint;
  v_updated bigint := 0;
  rec record;
  v_match text;
  v_cleaned text;
begin
  -- Проверка: вызывающий пользователь — owner/admin салона
  if not exists (
    select 1 from salon_members sm
    where sm.salon_id = p_salon_id
      and sm.user_id = auth.uid()
      and sm.role in ('owner', 'admin')
  ) then
    raise exception 'not_authorized';
  end if;

  -- Сколько всего tx без counterparty в этом салоне
  select count(*) into v_total
  from bank_transactions bt
  join bank_accounts ba on ba.id = bt.account_id
  join bank_connections bc on bc.id = ba.connection_id
  where bc.salon_id = p_salon_id
    and (bt.counterparty is null or bt.counterparty = '')
    and bt.description is not null
    and length(trim(bt.description)) > 0;

  -- Идём по каждой такой tx и пытаемся извлечь имя
  for rec in
    select bt.id, bt.description
    from bank_transactions bt
    join bank_accounts ba on ba.id = bt.account_id
    join bank_connections bc on bc.id = ba.connection_id
    where bc.salon_id = p_salon_id
      and (bt.counterparty is null or bt.counterparty = '')
      and bt.description is not null
      and length(trim(bt.description)) > 0
  loop
    v_match := null;

    -- (1) Leading UPPERCASE words до 4 шт
    v_match := substring(
      trim(rec.description)
      from '^([A-Z][A-Z0-9.\-]*(\s+[A-Z][A-Z0-9.\-]*){0,3})'
    );

    if v_match is not null and length(v_match) >= 3 then
      -- Cut at geo-noise
      v_cleaned := regexp_replace(
        v_match,
        '\s*(POZNAN|POZNA|WARSZAWA|KRAKOW|GDANSK|WROCLAW|LODZ|POL|PL|IRL|DE|US|UK|GB).*$',
        '',
        'i'
      );
      v_cleaned := trim(v_cleaned);
      if length(v_cleaned) >= 3 then
        v_match := v_cleaned;
      end if;
    else
      v_match := null;
    end if;

    -- (2) Домен-like
    if v_match is null then
      v_match := substring(
        trim(rec.description)
        from '^([A-Z][A-Z0-9]*\.(COM|PL|EU|NET|ORG))'
      );
    end if;

    -- (3) Title-case word, длина >= 4
    if v_match is null then
      v_match := substring(
        trim(rec.description)
        from '^([A-Z][a-z]{3,}(\*+[A-Za-z0-9]+)?)'
      );
    end if;

    if v_match is not null and length(v_match) >= 3 then
      update bank_transactions
      set counterparty = substring(v_match, 1, 200)
      where id = rec.id;
      v_updated := v_updated + 1;
    end if;
  end loop;

  return query select v_updated, v_total;
end;
$$;

grant execute on function public.extract_bank_tx_counterparty(uuid) to authenticated;

comment on function public.extract_bank_tx_counterparty is
  'Backfill counterparty для bank_transactions данного салона. '
  'Применяет regex-эвристику из banking-sync для строк где counterparty IS NULL. '
  'Возвращает (updated_count, total_with_null) — сколько строк обработано/всего таких было.';
