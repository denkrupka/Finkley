-- staff.phone — для SMS-приглашения мастера в портал и Booksy phone
-- auto-match. Раньше телефон жил только в salon_invitations.invited_phone
-- (одноразовый при invite). Теперь — постоянное поле на карточке staff.

alter table public.staff
  add column if not exists phone text;

comment on column public.staff.phone is
  'Телефон мастера (E.164 формат). Используется для SMS-приглашения в '
  'портал и Booksy auto-match по номеру.';

-- Бэкфилл из salon_invitations: если у staff_id уже было приглашение
-- с invited_phone — копируем.
update public.staff s
  set phone = i.invited_phone
  from public.salon_invitations i
  where i.staff_id = s.id
    and i.invited_phone is not null
    and s.phone is null;
