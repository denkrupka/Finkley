-- bank_connections.pending_today_count — счётчик «свежих» транзакций в
-- pending-статусе (EnableBanking → status='PDNG'), выявленных при последнем
-- запуске banking-sync. Используется UI чтобы сказать юзеру: «N транзакций
-- ещё не подтверждены банком, отобразятся в течение 1–24 часов».
--
-- Раньше pending молча отбрасывались, и юзер видел стоп-кадр на дате
-- последней booked-транзакции, считая что синк сломан. Это решает UX
-- без изменения dedup-логики (BOOK → постоянная запись).

alter table public.bank_connections
  add column if not exists pending_today_count integer not null default 0;

comment on column public.bank_connections.pending_today_count is
  'Сколько PDNG (не booked) транзакций было в последнем sync. UI показывает предупреждение если >0 — транзакция ещё не зафиксирована банком.';
