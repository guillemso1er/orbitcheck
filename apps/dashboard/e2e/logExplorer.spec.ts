import { test, expect } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';

test.describe('Log Explorer Flow', () => {
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

  test('should view logs in explorer', async ({ page }) => {
    // Already logged in from beforeEach, at /api-keys

    // Navigate to logs
    await page.goto('/logs');
    await expect(page).toHaveURL(/.*\/logs/);

    // Check if LogExplorer is loaded
    await expect(page.getByRole('region', { name: 'Log Explorer' })).toBeVisible();

    // Check table is visible
    await expect(page.locator('table.table')).toBeVisible();

    // Check for empty state since no logs
    await expect(page.locator('td', { hasText: 'No logs found.' })).toBeVisible();

    // Check filters section
    await expect(page.locator('#reason-code')).toBeVisible();
  });

  test('should apply filters', async ({ page }) => {
    // Already logged in from beforeEach

    // Navigate to logs
    await page.goto('/logs');
    await expect(page).toHaveURL(/.*\/logs/);

    // Apply filter
    await page.fill('#reason-code', 'test');
    await page.getByRole('button', { name: 'Apply Filters' }).click();

    // Check table still visible (no change in count, but filter applied)
    await expect(page.locator('table.table')).toBeVisible();
    await expect(page.locator('#reason-code')).toHaveValue('test');

    // Clear filters
    await page.getByRole('button', { name: 'Clear Filters' }).click();
    await expect(page.locator('#reason-code')).toHaveValue('');
  });
});