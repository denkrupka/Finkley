-- ADR-031: расширяем bank_tx_rules до богатой модели с conditions/actions.
-- См. decisions/031-bank-tx-rules-rich-model.md.
--
-- Старые колонки (counterparty_pattern, action, category_id) оставлены
-- nullable, чтобы существующий banking-sync продолжал работать в момент
-- деплоя. Удалим их отдельной миграцией после стабилизации.

-- Новые колонки.
alter table public.bank_tx_rules
  add column if not exists name text,
  add column if not exists enabled boolean not null default true,
  add column if not exists applies_to text not null default 'expense'
    check (applies_to in ('income', 'expense', 'both')),
  add column if not exists conditions jsonb not null default '[]'::jsonb,
  add column if not exists actions jsonb not null default '[]'::jsonb,
  add column if not exists sort_order int not null default 0;

-- Сделать старые колонки nullable (раньше counterparty_pattern и action
-- были NOT NULL). Новые правила пишутся без них.
alter table public.bank_tx_rules
  alter column counterparty_pattern drop not null,
  alter column action drop not null;

-- Бэкфилл: для каждой существующей строки сгенерировать новые поля из
-- старых. WHERE name IS NULL — чтобы повторный прогон миграции не ломал
-- уже отредактированные правила.
update public.bank_tx_rules
set
  name = counterparty_pattern,
  enabled = true,
  applies_to = 'both',
  conditions = jsonb_build_array(
    jsonb_build_object(
      'field', 'counterparty',
      'op', 'contains',
      'value', counterparty_pattern
    )
  ),
  actions = case
    when action = 'ignore' then
      jsonb_build_array(jsonb_build_object('type', 'ignore'))
    when action = 'auto_create' and category_id is not null then
      jsonb_build_array(jsonb_build_object(
        'type', 'set_category',
        'category_id', category_id::text
      ))
    else '[]'::jsonb
  end
where name is null;

-- Для новых правил (создаваемых из нового UI) name обязателен.
-- Делаем NOT NULL после бэкфилла, чтобы не упасть на пустых строках.
alter table public.bank_tx_rules
  alter column name set not null;

-- Индекс для быстрого извлечения активных правил салона в правильном
-- порядке (banking-sync делает один запрос на каждый salon с новыми tx).
create index if not exists idx_bank_tx_rules_salon_enabled_order
  on public.bank_tx_rules(salon_id, enabled, sort_order, created_at);

-- RLS-политики не трогаем — они уже покрывают всю таблицу через
-- salon_members в исходной миграции.

comment on column public.bank_tx_rules.name is
  'Имя правила (показывается в списке). ADR-031.';
comment on column public.bank_tx_rules.enabled is
  'Тоггл вкл/выкл. Disabled правила скипаются matcher-ом. ADR-031.';
comment on column public.bank_tx_rules.applies_to is
  'К каким tx применять: income / expense / both. ADR-031.';
comment on column public.bank_tx_rules.conditions is
  'Массив условий, AND. Контракт: [{field, op, value}]. См. ADR-031.';
comment on column public.bank_tx_rules.actions is
  'Массив действий, применяются по порядку. Контракт: [{type, ...payload}]. См. ADR-031.';
comment on column public.bank_tx_rules.sort_order is
  'Порядок применения правил (lower = first). ADR-031.';
comment on column public.bank_tx_rules.counterparty_pattern is
  'DEPRECATED ADR-031. Оставлено для совместимости со старым banking-sync; удалить в следующей миграции после стабилизации.';
comment on column public.bank_tx_rules.action is
  'DEPRECATED ADR-031. Оставлено для совместимости; удалить в следующей миграции.';
comment on column public.bank_tx_rules.category_id is
  'DEPRECATED ADR-031. Категория теперь в actions[].category_id; удалить в следующей миграции.';
