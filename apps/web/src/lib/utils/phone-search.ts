/**
 * Лёгкий хелпер для нормализации телефона для поиска. Вынесен отдельно от
 * format-phone.ts чтобы потребители не тащили в bundle libphonenumber-js
 * (она тяжёлая, ~80 KB после min-варианта). useClients достаточно
 * нормализатора без всякой логики номеров.
 */
export function normalizeSearchPhone(input: string): string {
  return input.replace(/[^\d+]/g, '')
}
