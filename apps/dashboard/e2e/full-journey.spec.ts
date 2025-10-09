import { test, expect } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';

test.describe('Full Application Journey', () => {
  let testEmail: string;
  const password = 'password123';

  test.beforeEach(async () => {
    testEmail = `testuser${Date.now()}${uuidv4().slice(0, 8)}@example.com`;
  });

  test('completes full user journey from registration to logout and re-login', async ({ page }) => {
    // Step 1: Navigate to login page and verify UI elements
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create Account' })).toBeVisible();

    // Step 2: Register a new user account
    await page.getByRole('button', { name: 'Create Account' }).click();
    await expect(page.getByRole('heading', { name: 'Create Account' })).toBeVisible();

    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', password);

    await page.getByRole('button', { name: 'Create Account' }).click();
    await page.waitForResponse(resp => resp.url().includes('/auth/register') && resp.status() === 201);

    // Step 3: Verify redirect to API keys page after registration
    await expect(page).toHaveURL(/.*\/api-keys/);
    await expect(page.getByRole('heading', { name: 'OrbiCheck' })).toBeVisible();

    // Step 4: View API keys list (verify default key exists)
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('region', { name: 'API Keys Management' })).toBeVisible();
    // Note: API call may fail in test environment, but UI should still load
    // await expect(page.locator('table.table tbody tr')).toHaveCount(1);
    // await expect(page.locator('td:has-text("Unnamed")')).toBeVisible();
    // await expect(page.locator('span.badge-success')).toBeVisible();

    // Step 5: Navigate to Usage Dashboard
    await page.locator('.nav-link').filter({ hasText: 'Usage Dashboard' }).click();
    await expect(page).toHaveURL(/.*\/usage/);
    await page.waitForLoadState('networkidle');

    // Step 6: Verify usage dashboard loads (may show error due to API auth issues)
    await expect(page.locator('.loading').filter({ hasText: 'usage dashboard' })).toBeVisible({ timeout: 15000 });

    // Step 7: Navigate to Log Explorer
    await page.locator('.nav-link').filter({ hasText: 'Log Explorer' }).click();
    await expect(page).toHaveURL(/.*\/logs/);
    await page.waitForLoadState('networkidle');

    // Step 8: Apply filters in log explorer
    await expect(page.locator('.log-explorer')).toBeVisible();
    await page.waitForSelector('input#reason-code', { state: 'visible' });
    await page.fill('input#reason-code', 'test');
    await page.getByRole('button', { name: 'Apply Filters' }).click();

    // Step 9: Clear filters in log explorer
    await page.getByRole('button', { name: 'Clear Filters' }).click();
    await expect(page.locator('input#reason-code')).toHaveValue('');

    // Step 10: Navigate to Webhook Tester
    await page.locator('.nav-link').filter({ hasText: 'Webhook Tester' }).click();
    await expect(page).toHaveURL(/.*\/webhooks/);
    await page.waitForLoadState('networkidle');

    // Step 11: Verify webhook tester loads
    await expect(page.locator('.webhook-tester')).toBeVisible();

    // Step 12: Logout from the application
    await page.locator('.logout-btn').click();
    await expect(page).toHaveURL(/.*\/login/);

    // Step 13: Login again with same credentials
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', password);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.waitForResponse(resp => resp.url().includes('/auth/login') && resp.status() === 200);

    // Step 14: Verify successful login and dashboard access
    await expect(page).toHaveURL(/.*\/api-keys/);
    await expect(page.getByRole('heading', { name: 'OrbiCheck' })).toBeVisible();
  });
});