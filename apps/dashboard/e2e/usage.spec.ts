import { test, expect } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';

test.describe('Usage Dashboard Flow', () => {
  let testEmail: string;
  const password = 'password123';

  test.beforeEach(async ({ page }) => {
    testEmail = `testuser${Date.now()}${uuidv4().slice(0, 8)}@example.com`;

    // Register new user
    await page.goto('/login');
    await page.getByRole('button', { name: 'Create Account' }).click();
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', password);
    await page.getByRole('button', { name: 'Create Account' }).click();
    await expect(page).toHaveURL(/.*\/api-keys/);
  });

  test('should view usage dashboard', async ({ page }) => {
    const password = 'password123';

    // Login
    await page.goto('/login');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', password);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL(/.*\/api-keys/);

    // Navigate to usage
    await page.goto('/usage');
    await expect(page).toHaveURL(/.*\/usage/);

    // Check page loaded
    await expect(page.getByRole('heading', { name: 'Usage Dashboard' })).toBeVisible();

    // Check stats grid
    await expect(page.locator('.stats-grid')).toBeVisible();
    await expect(page.locator('.stat-card')).toHaveCount(3);

    // Check charts
    await expect(page.locator('.chart-container')).toHaveCount(3);
    await expect(page.locator('canvas')).toHaveCount(3); // Charts rendered
  });
});