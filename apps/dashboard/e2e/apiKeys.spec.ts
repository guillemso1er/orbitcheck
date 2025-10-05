import { test, expect } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';

test.describe('API Keys Management Flow', () => {
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
    await page.waitForResponse(resp => resp.url().includes('/auth/register') && resp.status() === 201);
    await expect(page).toHaveURL(/.*\/api-keys/);
  });

  test('should view API keys list', async ({ page }) => {
    // Already on /api-keys after registration

    // Wait for load
    await page.waitForLoadState('networkidle');

    // Check page loaded
    await expect(page.getByRole('region', { name: 'API Keys Management' })).toBeVisible();

    // Expect default API key
    await expect(page.locator('table.table tbody tr')).toHaveCount(1);
    await expect(page.locator('td:has-text("Unnamed")')).toBeVisible();
    await expect(page.locator('span.badge-success')).toBeVisible();
  });

  test('should create new API key', async ({ page }) => {
    // Already on /api-keys

    // Wait for load
    await page.waitForLoadState('networkidle');

    // Click create button
    await page.getByRole('button', { name: 'Create New API Key' }).click();
    await expect(page.locator('.modal')).toBeVisible({ timeout: 10000 });

    // Fill name and submit
    await page.waitForSelector('#key-name', { state: 'visible' });
    await page.fill('#key-name', 'Test Key');
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    // Expect success alert
    await expect(page.locator('.alert-success')).toBeVisible({ timeout: 10000 });
    
    // Check for API key in the alert (look for the full API key in the alert)
    await expect(page.locator('code').filter({ hasText: /^ok_[a-f0-9]{64}$/ })).toBeVisible({ timeout: 10000 });
    
    // Close alert - be more specific about which close button
    await page.locator('.alert-success button').click();

    // Check list updated
    await expect(page.locator('table.table tbody tr')).toHaveCount(2);
    await expect(page.locator('td').filter({ hasText: "Test Key" })).toBeVisible();
  });

  test('should revoke API key', async ({ page }) => {
    // Already on /api-keys

    // Wait for load
    await page.waitForLoadState('networkidle');

    // Handle dialog
    page.on('dialog', dialog => dialog.accept());

    // Confirm revoke (default key)
    await page.locator('button:has-text("Revoke")').first().click();

    // Expect list updated
    await expect(page.locator('span.badge-danger')).toBeVisible();
  });
});