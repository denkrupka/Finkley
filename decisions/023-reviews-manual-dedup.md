# ADR-023: Reviews импорт — manual dedup вместо ON CONFLICT

**Дата:** 2026-05-22
**Статус:** Принято
**Контекст:** Коммит `4e14079`

## Контекст

Edge function `reviews-sync` импортирует отзывы Google Places + Booksy
в таблицу `reviews`. Anti-duplicate gate должен предотвращать повторные
вставки одного и того же external_id (Google review id, Booksy review
id).

Изначально использовался Postgres `INSERT ... ON CONFLICT` через
PostgREST upsert:

```ts
await admin.from('reviews').upsert(inserts, {
  onConflict: 'salon_id,source,external_id',
  ignoreDuplicates: false,
})
```

## Проблема

`reviews.external_id` для внутренних (kind=internal) отзывов NULL —
у них нет внешнего ID. Поэтому уникальный индекс — **partial**:

```sql
create unique index ux_reviews_external
  on public.reviews(salon_id, source, external_id)
  where external_id is not null;
```

PostgreSQL **не принимает partial unique index** как valid ON CONFLICT
target — нужен точный match по WHERE, который `INSERT ... ON CONFLICT
(salon_id, source, external_id)` не указывает.

Результат: каждый upsert тихо падал с
`there is no unique or exclusion constraint matching the ON CONFLICT
specification`, но **код не проверял error**, и `imported` оставался 0.

Юзер видел «Импортировано 0 отзывов» в UI, хотя Google API реально
возвращал 5 reviews и API-call проходил успешно.

## Решение

Заменить upsert на manual dedup:

```ts
const sources = Array.from(new Set(inserts.map((i) => i.source)))
const { data: existing } = await admin
  .from('reviews')
  .select('source, external_id')
  .eq('salon_id', salon.id)
  .in('source', sources)
  .not('external_id', 'is', null)

const taken = new Set(existing.map((r) => `${r.source}::${r.external_id}`))
const fresh = inserts.filter((r) => !taken.has(`${r.source}::${r.external_id}`))

if (fresh.length > 0) {
  await admin.from('reviews').insert(fresh)
}
```

Плюс debug-агрегат в response для будущей диагностики:

```ts
{ ok: true, imported, debug: [{ salon_id, salon_name,
  google_reviews_fetched, booksy_reviews_fetched, upsert_error? }] }
```

## Альтернативы (отвергнутые)

1. **Изменить unique index на non-partial** (требует `external_id NOT
NULL`): сломает внутренние отзывы которые external_id не имеют.
2. **NULLS NOT DISTINCT** (Postgres 15+): теоретически работает, но
   Supabase managed Postgres не везде гарантирует версию + поведение
   ON CONFLICT с NULLS NOT DISTINCT всё равно тонкое.
3. **Два разных таблицы** для внутренних и внешних отзывов: сильное
   усложнение UI и хуков, дублирование RLS.
4. **Trigger BEFORE INSERT с raise unique_violation**: переусложнение
   для read-после-insert операции.

## Защита от регрессии

- Debug-агрегат в response: легко увидеть `upsert_error` если что-то
  пойдёт не так.
- Smoke-тест в проде после деплоя: `reviews-sync` для Wondefrul
  возвращает `imported: 5, google_reviews_fetched: 5`.
- При повторном вызове `imported: 0` (manual dedup правильно
  фильтрует существующие).

## Урок

Когда вводишь partial unique index — сразу проверяй, что upsert на
эту таблицу не используется (или используется с явным `where`-условием).
PostgREST upsert не позволяет передавать partial-where клаузу.
