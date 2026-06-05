-- =============================================================================
-- Bucket 'receipts' — добавляем application/xml + text/xml для KSeF фактур.
--
-- Owner-feedback 05.06: глазок-viewer (KsefInvoiceViewer) не открывается
-- потому что receipt_url=null. Причина — ksef-proxy получает XML от
-- KSeF API и пытается upload в bucket с MIME application/xml. Bucket
-- разрешал только image/* и application/pdf → upload падал с
-- 'mime type application/xml is not supported'.
--
-- Добавляем XML mime types к существующему списку.
-- =============================================================================

update storage.buckets
   set allowed_mime_types = allowed_mime_types || array['application/xml', 'text/xml']
 where id = 'receipts'
   and not ('application/xml' = any(allowed_mime_types));
