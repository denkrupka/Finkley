import { describe, it, expect } from 'vitest'

import { humanizeTag } from './client-tags'

describe('humanizeTag', () => {
  it('маппит известные booksy теги', () => {
    expect(humanizeTag('booksy:app_user')).toBe('Клиент Booksy')
    expect(humanizeTag('booksy:blacklisted')).toBe('В чёрном списке')
    expect(humanizeTag('booksy:from_promo')).toBe('Пришёл по промо')
    expect(humanizeTag('booksy:frequent_no_show')).toBe('Часто не приходит')
  })

  it('маппит RFM/аналитические теги', () => {
    expect(humanizeTag('active')).toBe('Активный')
    expect(humanizeTag('at_risk')).toBe('Под угрозой ухода')
    expect(humanizeTag('churned')).toBe('Ушёл')
    expect(humanizeTag('new')).toBe('Новый')
    expect(humanizeTag('vip')).toBe('VIP')
  })

  it('неизвестный booksy:* — снимает префикс и underscore', () => {
    expect(humanizeTag('booksy:custom_tag')).toBe('custom tag')
  })

  it('неизвестный без namespace — возвращает с заменой _ на пробел', () => {
    expect(humanizeTag('some_custom_tag')).toBe('some custom tag')
  })
})
