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
    await expect(page).toHaveURL(/.*\/api\/keys/);
  });

  test('should view usage dashboard', async ({ page }) => {
    // Already logged in from beforeEach, at /api/keys

    // Navigate to usage
    await page.goto('/usage');
    await expect(page).toHaveURL(/.*\/usage/);

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Check page loaded with better error handling
    await expect(page.locator('h1, h2, h3, .page-header, .usage-dashboard')).toBeVisible({ timeout: 15000 });

    // Check stats grid
    await expect(page.locator('.stats-grid')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.stat-card')).toHaveCount(3);

    // Check charts - look for chart containers by their class names
    await expect(page.locator('.chart-card')).toHaveCount(3);
    await expect(page.locator('canvas')).not.toHaveCount(0); // At least one chart rendered
  });
});