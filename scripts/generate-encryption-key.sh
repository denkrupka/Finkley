#!/usr/bin/env bash
# =============================================================================
# generate-encryption-key.sh
# =============================================================================
# Генерирует криптографически стойкий ключ AES-256 (32 байта) в base64.
# Используется как SECRETS_ENCRYPTION_KEY для шифрования integration_credentials.
#
# Запуск:
#   ./scripts/generate-encryption-key.sh
#
# Или прямо в команде установки секрета:
#   pnpm supabase secrets set SECRETS_ENCRYPTION_KEY="$(./scripts/generate-encryption-key.sh)"
#
# ⚠ ВАЖНО:
#   - Ключ генерируется ОДИН РАЗ на окружение (staging и prod — разные ключи)
#   - НЕ меняй ключ после первой записи в integration_credentials
#   - Если потерял — все зашифрованные secrets придётся удалить (юзеры переподключат интеграции)
#   - Сохрани копию в надёжном месте (1Password / Bitwarden), на случай ротации Supabase
# =============================================================================

set -e

# Проверяем наличие openssl
if ! command -v openssl &> /dev/null; then
  echo "Error: openssl не установлен" >&2
  exit 1
fi

# Генерируем 32 байта случайных данных и кодируем в base64
KEY=$(openssl rand -base64 32)

# Печатаем ключ
echo "$KEY"

# Если запущено напрямую (не через подстановку), показываем подсказку в stderr
if [ -t 1 ]; then
  echo "" >&2
  echo "✓ Ключ сгенерирован." >&2
  echo "" >&2
  echo "Установить в Supabase Function Secrets:" >&2
  echo "  pnpm supabase secrets set SECRETS_ENCRYPTION_KEY=\"$KEY\"" >&2
  echo "" >&2
  echo "Сохрани копию в безопасном месте (1Password / Bitwarden)." >&2
fi
