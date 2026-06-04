-- =============================================================================
-- Helper public.has_perm(salon_id, category, sub, action) — будущая основа
-- для RLS политик per-permission. Сейчас НЕ подключаю к существующим
-- политикам (risk сломать owner/admin доступ), но функция готова для
-- использования в новых таблицах или для проверок в Edge Functions.
--
-- Логика та же что в apps/web/src/hooks/permissions-logic.ts:
--   1. owner / admin → всегда true
--   2. Иначе читаем salon_members.permissions для auth.uid():
--      - exact match "category.sub" → ok если уровень >= требуемого
--      - wildcard "category.*" → ok если уровень >= требуемого
--      - 'view' пропускается и для 'view' и для 'edit' проверкой
--      - 'edit' пропускается только если в permissions = 'edit'
-- =============================================================================

create or replace function public.has_perm(
  p_salon_id uuid,
  p_category text,
  p_sub text default null,
  p_action text default 'view'
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_perms jsonb;
  v_exact text;
  v_wild text;
  v_perm text;
begin
  if auth.uid() is null then
    return false;
  end if;

  select role, permissions into v_role, v_perms
    from public.salon_members
    where salon_id = p_salon_id and user_id = auth.uid();

  if v_role is null then
    return false;
  end if;

  -- Owner/admin: полный доступ ко всему
  if v_role in ('owner', 'admin') then
    return true;
  end if;

  -- Бухгалтер: дефолт view/edit для финансов; permissions может override.
  -- Здесь только check permissions matrix.

  v_perms := coalesce(v_perms, '{}'::jsonb);
  v_exact := p_category || '.' || coalesce(p_sub, p_category);
  v_wild := p_category || '.*';

  v_perm := coalesce(v_perms->>v_exact, v_perms->>v_wild);

  if v_perm is null then
    return false;
  end if;

  if p_action = 'view' then
    return v_perm in ('view', 'edit');
  end if;
  if p_action = 'edit' then
    return v_perm = 'edit';
  end if;

  return false;
end;
$$;

revoke all on function public.has_perm(uuid, text, text, text) from public;
grant execute on function public.has_perm(uuid, text, text, text) to authenticated;

comment on function public.has_perm(uuid, text, text, text) is
  'T36 — проверка permissions для текущего auth.uid() на p_salon_id. Owner/admin → true всегда. Иначе читает salon_members.permissions[category.sub] или [category.*] и проверяет уровень доступа (view/edit). Использовать в RLS политиках новых таблиц или в Edge Functions для server-side guard.';
