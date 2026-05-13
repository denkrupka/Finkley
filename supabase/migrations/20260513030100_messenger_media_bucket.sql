-- Bucket для медиа-вложений в мессенджере (фото/видео/аудио/файлы).
-- Объекты публично-читаемы по signed-url'ам; запись — только для членов салона.
-- Path convention: <salon_id>/<conversation_id>/<random_uuid>.<ext>

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'messenger-media',
  'messenger-media',
  false,
  20 * 1024 * 1024,  -- 20 MB max
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/quicktime',
    'audio/mpeg', 'audio/ogg', 'audio/mp4', 'audio/webm',
    'application/pdf'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- RLS: read/write только для члена салона, чей UUID — первый сегмент пути.
DROP POLICY IF EXISTS "members read messenger-media" ON storage.objects;
CREATE POLICY "members read messenger-media"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'messenger-media'
    AND (
      (storage.foldername(name))[1]::uuid IN (
        SELECT salon_id FROM salon_members WHERE user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "members write messenger-media" ON storage.objects;
CREATE POLICY "members write messenger-media"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'messenger-media'
    AND (
      (storage.foldername(name))[1]::uuid IN (
        SELECT salon_id FROM salon_members WHERE user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "members delete messenger-media" ON storage.objects;
CREATE POLICY "members delete messenger-media"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'messenger-media'
    AND (
      (storage.foldername(name))[1]::uuid IN (
        SELECT salon_id FROM salon_members WHERE user_id = auth.uid()
      )
    )
  );
