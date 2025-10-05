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
    await expect(page).toHaveURL(/.*\/api\/keys/);
  });

  test('should view API keys list', async ({ page }) => {
    // Already on /api/keys after registration

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
    // Already on /api/keys

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
    // Already on /api/keys

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

test.describe('API Keys Authentication Fix Verification', () => {
  let testEmail: string;
  const password = 'password123';

  test.beforeEach(async ({ page }) => {
    testEmail = `testuser${Date.now()}@example.com`;

    // Register new user
    await page.goto('/login');
    await page.getByRole('button', { name: 'Create Account' }).click();
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', password);
    await page.getByRole('button', { name: 'Create Account' }).click();
    await page.waitForResponse(resp => resp.url().includes('/auth/register') && resp.status() === 201);
    await expect(page).toHaveURL(/.*\/api-keys/);
  });

  test('should successfully load API keys without 401 error', async ({ page }) => {
    // Wait for page to load completely
    await page.waitForLoadState('networkidle');
    
    // Check that we can see the API keys management section
    await expect(page.getByRole('region', { name: 'API Keys Management' })).toBeVisible();
    
    // Verify that API keys table is present and has data
    await expect(page.locator('table.table')).toBeVisible();
    await expect(page.locator('table.table tbody tr')).toHaveCount(1); // Should have at least the default key
    
    // Verify no error messages are displayed
    await expect(page.locator('.alert-danger')).not.toBeVisible();
    await expect(page.locator('text=/Error: Failed to fetch API keys/')).not.toBeVisible();
    
    // Verify the API key data is displayed correctly
    await expect(page.locator('td:has-text("Unnamed")')).toBeVisible();
    await expect(page.locator('span.badge-success')).toBeVisible();
    await expect(page.locator('code')).toBeVisible(); // Should show the key prefix
  });

  test('should handle navigation to API keys page without auth errors', async ({ page }) => {
    // Navigate away from API keys page
    await page.goto('/');
    
    // Navigate back to API keys page
    await page.goto('/api/keys');
    
    // Wait for page to load
    await page.waitForLoadState('networkidle');
    
    // Verify the page loads successfully without errors
    await expect(page.getByRole('region', { name: 'API Keys Management' })).toBeVisible();
    
    // Verify network requests were successful (no 401 responses)
    const apiResponses = page.waitForResponse(resp =>
      resp.url().includes('/api/keys') && resp.status() === 200
    );
    await expect(apiResponses).resolves.toBeDefined();
    
    // Verify the API keys table loads
    await expect(page.locator('table.table')).toBeVisible();
    await expect(page.locator('table.table tbody tr')).toHaveCount(1);
  });

  test('should display API key details correctly after successful fetch', async ({ page }) => {
    // Wait for initial load
    await page.waitForLoadState('networkidle');
    
    // Get the API key prefix from the table
    const keyPrefix = await page.locator('table.table tbody tr td code').textContent();
    expect(keyPrefix).toMatch(/^ok_[a-f0-9]{5}$/); // Should match the pattern
    
    // Verify all expected columns are present
    await expect(page.locator('th').filter({ hasText: 'Name' })).toBeVisible();
    await expect(page.locator('th').filter({ hasText: 'Prefix' })).toBeVisible();
    await expect(page.locator('th').filter({ hasText: 'Status' })).toBeVisible();
    await expect(page.locator('th').filter({ hasText: 'Created' })).toBeVisible();
    await expect(page.locator('th').filter({ hasText: 'Last Used' })).toBeVisible();
    await expect(page.locator('th').filter({ hasText: 'Actions' })).toBeVisible();
    
    // Verify the default key has correct data
    await expect(page.locator('td').filter({ hasText: 'Unnamed' })).toBeVisible();
    await expect(page.locator('span.badge-success')).toBeVisible();
    await expect(page.locator('td').filter({ hasText: 'Never' })).toBeVisible(); // Last Used should be "Never"
  });
});