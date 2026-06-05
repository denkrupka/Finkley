-- BROAD dedup для всех справочников и операционных таблиц.

-- ─── clients (по salon + phone OR email) ─────────────────────────────────
do $$
declare v_g record; v_total int := 0; v_iter int;
begin
  for v_g in
    select array_agg(id order by created_at asc) as ids
    from public.clients
    where deleted_at is null and lower(trim(coalesce(phone, ''))) <> ''
    group by salon_id, lower(trim(phone))
    having count(*) > 1
  loop
    update public.clients set deleted_at = now()
     where id = any((v_g.ids)[2:]) and deleted_at is null;
    get diagnostics v_iter = row_count;
    v_total := v_total + v_iter;
  end loop;
  raise notice 'clients dedup by phone: %', v_total;

  v_total := 0;
  for v_g in
    select array_agg(id order by created_at asc) as ids
    from public.clients
    where deleted_at is null and lower(trim(coalesce(email, ''))) <> ''
    group by salon_id, lower(trim(email))
    having count(*) > 1
  loop
    update public.clients set deleted_at = now()
     where id = any((v_g.ids)[2:]) and deleted_at is null;
    get diagnostics v_iter = row_count;
    v_total := v_total + v_iter;
  end loop;
  raise notice 'clients dedup by email: %', v_total;
end$$;

-- ─── staff (external_id + lower(full_name)) ─────────────────────────────
do $$
declare v_g record; v_total int := 0; v_iter int;
begin
  for v_g in
    select array_agg(id order by created_at asc) as ids
    from public.staff
    where deleted_at is null
      and external_source is not null and external_id is not null
    group by salon_id, external_source, external_id
    having count(*) > 1
  loop
    update public.staff set deleted_at = now()
     where id = any((v_g.ids)[2:]) and deleted_at is null;
    get diagnostics v_iter = row_count;
    v_total := v_total + v_iter;
  end loop;
  raise notice 'staff dedup by external_id: %', v_total;

  v_total := 0;
  for v_g in
    select array_agg(id order by created_at asc) as ids
    from public.staff
    where deleted_at is null
      and lower(trim(coalesce(full_name, ''))) <> ''
    group by salon_id, lower(trim(full_name))
    having count(*) > 1
  loop
    update public.staff set deleted_at = now()
     where id = any((v_g.ids)[2:]) and deleted_at is null;
    get diagnostics v_iter = row_count;
    v_total := v_total + v_iter;
  end loop;
  raise notice 'staff dedup by full_name: %', v_total;
end$$;

-- ─── services (external_id + lower(name) + price + duration) ─────────────
do $$
declare v_g record; v_total int := 0; v_iter int;
begin
  for v_g in
    select array_agg(id order by created_at asc) as ids
    from public.services
    where is_archived = false
      and external_source is not null and external_id is not null
    group by salon_id, external_source, external_id
    having count(*) > 1
  loop
    update public.services set is_archived = true
     where id = any((v_g.ids)[2:]) and is_archived = false;
    get diagnostics v_iter = row_count;
    v_total := v_total + v_iter;
  end loop;
  raise notice 'services dedup by external_id: %', v_total;

  v_total := 0;
  for v_g in
    select array_agg(id order by created_at asc) as ids
    from public.services
    where is_archived = false
      and lower(trim(coalesce(name, ''))) <> ''
    group by salon_id, lower(trim(name)),
             coalesce(default_price_cents, 0),
             coalesce(default_duration_min, 0)
    having count(*) > 1
  loop
    update public.services set is_archived = true
     where id = any((v_g.ids)[2:]) and is_archived = false;
    get diagnostics v_iter = row_count;
    v_total := v_total + v_iter;
  end loop;
  raise notice 'services dedup by name+price+duration: %', v_total;
end$$;

-- ─── visits (salon + visit_at + client + staff + service + external_id) ──
do $$
declare v_g record; v_total int := 0; v_iter int;
begin
  for v_g in
    select array_agg(id order by created_at asc) as ids
    from public.visits
    where deleted_at is null and visit_at is not null
    group by salon_id, visit_at,
             coalesce(client_id::text, ''),
             coalesce(staff_id::text, ''),
             coalesce(service_id::text, ''),
             coalesce(source, ''),
             coalesce(external_id, '')
    having count(*) > 1
  loop
    update public.visits set deleted_at = now()
     where id = any((v_g.ids)[2:]) and deleted_at is null;
    get diagnostics v_iter = row_count;
    v_total := v_total + v_iter;
  end loop;
  raise notice 'visits dedup: %', v_total;
end$$;

-- ─── counterparties ─────────────────────────────────────────────────────
do $$
declare v_g record; v_total int := 0; v_iter int;
begin
  for v_g in
    select array_agg(id order by created_at asc) as ids
    from public.counterparties
    where lower(trim(coalesce(nip, ''))) <> ''
    group by salon_id, lower(trim(nip))
    having count(*) > 1
  loop
    delete from public.counterparties where id = any((v_g.ids)[2:]);
    get diagnostics v_iter = row_count;
    v_total := v_total + v_iter;
  end loop;
  raise notice 'counterparties dedup by NIP: %', v_total;

  v_total := 0;
  for v_g in
    select array_agg(id order by created_at asc) as ids
    from public.counterparties
    where lower(trim(coalesce(name, ''))) <> ''
    group by salon_id, lower(trim(name))
    having count(*) > 1
  loop
    delete from public.counterparties where id = any((v_g.ids)[2:]);
    get diagnostics v_iter = row_count;
    v_total := v_total + v_iter;
  end loop;
  raise notice 'counterparties dedup by name: %', v_total;
end$$;

-- ─── expense_categories ────────────────────────────────────────────────
do $$
declare v_g record; v_total int := 0; v_iter int;
begin
  for v_g in
    select array_agg(id order by created_at asc) as ids
    from public.expense_categories
    where lower(trim(coalesce(name, ''))) <> ''
    group by salon_id, lower(trim(name))
    having count(*) > 1
  loop
    delete from public.expense_categories where id = any((v_g.ids)[2:]);
    get diagnostics v_iter = row_count;
    v_total := v_total + v_iter;
  end loop;
  raise notice 'expense_categories dedup: %', v_total;
end$$;

-- ─── service_categories ───────────────────────────────────────────────
do $$
declare v_g record; v_total int := 0; v_iter int;
begin
  for v_g in
    select array_agg(id order by created_at asc) as ids
    from public.service_categories
    where lower(trim(coalesce(name, ''))) <> ''
    group by salon_id, lower(trim(name))
    having count(*) > 1
  loop
    delete from public.service_categories where id = any((v_g.ids)[2:]);
    get diagnostics v_iter = row_count;
    v_total := v_total + v_iter;
  end loop;
  raise notice 'service_categories dedup: %', v_total;
end$$;

-- ─── inventory_items ──────────────────────────────────────────────────
do $$
declare v_g record; v_total int := 0; v_iter int;
begin
  for v_g in
    select array_agg(id order by created_at asc) as ids
    from public.inventory_items
    where lower(trim(coalesce(name, ''))) <> ''
    group by salon_id, lower(trim(name))
    having count(*) > 1
  loop
    delete from public.inventory_items where id = any((v_g.ids)[2:]);
    get diagnostics v_iter = row_count;
    v_total := v_total + v_iter;
  end loop;
  raise notice 'inventory_items dedup: %', v_total;
end$$;
