import { test, expect } from '@playwright/test'

test('home shows welcome and register entry point', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Start.*register/i })).toBeVisible()
})
