import { test, expect } from '@playwright/test'

test.describe('smoke', () => {
  test('гостя редиректит на /login', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: /Войти в Finkley/i })).toBeVisible()
  })

  test('unknown route → SPA fallback → /login', async ({ page }) => {
    await page.goto('/this-route-does-not-exist')
    // path="*" → Navigate to "/" → RequireAuth → /login
    await expect(page).toHaveURL(/\/login$/)
  })
})
