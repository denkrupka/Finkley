-- =============================================================================
-- scheduled_payments.receipt_url — для KSeF XML preview (глазок-viewer).
--
-- Owner-feedback 05.06: 35 неоплаченных KSeF фактур попадают в
-- scheduled_payments (статус pending). Глазок-viewer уже есть для
-- expenses, но scheduled_payments не имел receipt_url → XML не
-- сохранялся → нет визуализации.
-- =============================================================================

alter table public.scheduled_payments
  add column if not exists receipt_url text;
