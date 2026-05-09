-- Расширяем whitelist MIME-типов для bug-attachments: добавляем audio/*
-- (для голосовых из Telegram bug-collector). Без этого voice/audio файлы
-- не загружаются и storage_path остаётся null.
update storage.buckets
   set allowed_mime_types = array[
     'image/jpeg','image/png','image/webp','image/heic','image/gif',
     'application/pdf','video/mp4',
     'audio/ogg','audio/mpeg','audio/mp4','audio/wav','audio/webm','audio/x-m4a'
   ]
 where id = 'bug-attachments';
