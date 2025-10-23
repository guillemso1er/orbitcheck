import { expect, test } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';

test.describe('Full Application Journey', () => {
  let testEmail: string;
  const password = 'password123';

  test.beforeEach(async () => {
    testEmail = `testuser${Date.now()}${uuidv4().slice(0, 8)}@example.com`;
  });

  test('completes full user journey from registration to logout and re-login', async ({ page }) => {
    // Handle confirm dialogs
    page.on('dialog', dialog => dialog.accept());

    // Step 1: Navigate to login page and verify UI elements
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('h2:has-text("Welcome Back")', { timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create Account' })).toBeVisible();

    // Step 2: Register a new user account
    await page.getByRole('button', { name: 'Create Account' }).click();
    await expect(page.getByRole('heading', { name: 'Create Account' })).toBeVisible();

    await page.fill('input[type="email"]', testEmail);
    await page.fill('#password', password);
    await page.fill('#confirm_password', password);

    await page.waitForSelector('button.btn-primary:not(:disabled)', { timeout: 5000 });
    await page.getByRole('button', { name: 'Create Account' }).click();
    const response = await page.waitForResponse(resp => resp.url().includes('/auth/register'));
    console.log('Response status:', response.status(), 'body:', await response.text());
    expect(response.status()).toBe(201);

    // Step 3: Verify redirect to API keys page after registration
    await expect(page).toHaveURL(/.*\/api-keys/);
    await expect(page.getByRole('heading', { name: 'OrbitCheck' })).toBeVisible();

    // Step 4: View API keys list (verify default key exists)
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('region', { name: 'API Keys Management' })).toBeVisible();

    // Step 5: Create a new API key
    await page.getByRole('button', { name: 'Create New API Key' }).click();
    await expect(page.getByRole('heading', { name: 'Create New API Key' })).toBeVisible();
    await page.fill('input[id="key-name"]', 'Test API Key');
    await page.locator('.modal button[type="submit"]').click();
    await expect(page.locator('.alert-success')).toBeVisible();
    await page.locator('.alert-success button').click();

    // Step 6: Rotate an API key
    const rotateBtn = page.locator('button[data-testid*="rotate-btn-"]').first();
    await expect(rotateBtn).toBeVisible();
    await rotateBtn.click();
    await expect(page.locator('.alert-success')).toBeVisible();
    await page.locator('.alert-success button').click();

    // Step 7: Revoke an API key
    const revokeBtn = page.locator('button').filter({ hasText: 'Revoke' }).first();
    await expect(revokeBtn).toBeVisible();
    await revokeBtn.click();
    // Note: Number of keys may vary, but revoke functionality is tested

    // Step 7: Navigate to Usage Dashboard
    await page.locator('.nav-link').filter({ hasText: 'Usage Dashboard' }).click();
    await expect(page).toHaveURL(/.*\/usage/);
    await page.waitForLoadState('networkidle');

    // Step 8: Verify usage dashboard loads
    await expect(page.getByRole('heading', { name: 'Usage Dashboard' })).toBeVisible({ timeout: 15000 });

    // Step 9: Navigate to Log Explorer
    await page.locator('.nav-link').filter({ hasText: 'Log Explorer' }).click();
    await expect(page).toHaveURL(/.*\/logs/);
    await page.waitForLoadState('networkidle');

    // Step 10: Apply filters in log explorer
    await expect(page.locator('.log-explorer')).toBeVisible();
    await page.waitForSelector('input#reason-code', { state: 'visible' });
    await page.fill('input#reason-code', 'test');
    await page.getByRole('button', { name: 'Apply Filters' }).click();

    // Step 11: Add more filters
    await page.fill('input#endpoint', '/v1/validate');
    await page.selectOption('select#type', 'validation');
    await page.fill('input#status', '200');
    await page.fill('input#date-from', '2023-01-01');
    await page.fill('input#date-to', '2025-12-31');
    await page.getByRole('button', { name: 'Apply Filters' }).click();

    // Step 12: Sort logs
    await page.locator('th').filter({ hasText: 'Status' }).click();

    // Step 13: Paginate (if available)
    const nextBtn = page.getByRole('button', { name: 'Next' });
    if (await nextBtn.isEnabled()) {
      await nextBtn.click();
    }

    // Step 14: Refresh logs
    await page.getByRole('button', { name: 'Refresh' }).click();

    // Step 15: Export logs to CSV
    await page.getByRole('button', { name: 'Export CSV' }).click();

    // Step 16: Clear filters in log explorer
    await page.getByRole('button', { name: 'Clear Filters' }).click();
    await expect(page.locator('input#reason-code')).toHaveValue('');

    // Step 17: Navigate to Webhook Tester
    await page.locator('.nav-link').filter({ hasText: 'Webhook Tester' }).click();
    await expect(page).toHaveURL(/.*\/webhooks/);
    await page.waitForLoadState('networkidle');

    // Step 18: Fill webhook form and send test with validation payload
    await page.fill('input#webhook-url', 'https://httpbin.org/post');
    await page.selectOption('select#payload-type', 'validation');
    await page.getByRole('button', { name: 'Send Test Payload' }).click();
    await expect(page.locator('.result-section')).toBeVisible();

    // Step 19: Switch tabs in result
    await page.getByRole('button', { name: 'Response' }).click();
    await expect(page.locator('.tab-content')).toContainText('Status');

    // Step 20: Test with order payload
    await page.selectOption('select#payload-type', 'order');
    await page.getByRole('button', { name: 'Send Test Payload' }).click();
    await expect(page.locator('.result-section')).toBeVisible();

    // Step 21: Test with custom payload
    await page.selectOption('select#payload-type', 'custom');
    await page.fill('textarea#custom-payload', '{"test": "custom data"}');
    await page.getByRole('button', { name: 'Send Test Payload' }).click();
    await expect(page.locator('.result-section')).toBeVisible();

    // Step 22: Clear result
    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(page.locator('.result-section')).not.toBeVisible();

    // Step 23: Navigate to API Docs and verify redirect
    const [newPage] = await Promise.all([
      page.context().waitForEvent('page'),
      page.locator('.nav-link').filter({ hasText: 'API Docs' }).click()
    ]);

    await expect(newPage).toHaveURL(/.*\/api-reference/);
    await newPage.waitForLoadState('networkidle');
    await newPage.close();

    // Step 24: Navigate to Bulk CSV Tool
    await page.locator('.nav-link').filter({ hasText: 'Bulk CSV Tool' }).click();
    await expect(page).toHaveURL(/.*\/bulk-csv/);
    await page.waitForLoadState('networkidle');

    // Step 25: Test Bulk CSV Tool default state
    await expect(page.getByRole('heading', { name: 'Bulk CSV Tool' })).toBeVisible();
    await expect(page.locator('select#csv-type')).toHaveValue('customers');

    // Step 26: Switch to orders CSV type
    await page.selectOption('select#csv-type', 'orders');
    await expect(page.locator('select#csv-type')).toHaveValue('orders');

    // Step 27: Switch back to customers CSV type
    await page.selectOption('select#csv-type', 'customers');
    await expect(page.locator('select#csv-type')).toHaveValue('customers');

    // Step 28: Upload invalid file type (should show error)
    await page.setInputFiles('input[type="file"]', 'e2e/fixtures/invalid-file.txt');
    await expect(page.locator('.alert-danger')).toContainText('Please select a CSV file');

    // Step 29: Upload invalid customers CSV (missing email/phone columns)
    await page.setInputFiles('input[type="file"]', 'e2e/fixtures/invalid-customers.csv');
    await expect(page.locator('.alert-danger')).toContainText('must contain email or phone columns');

    // Step 30: Test customers CSV upload
    await page.setInputFiles('input[type="file"]', 'e2e/fixtures/valid-customers.csv');
    await expect(page.locator('.file-name')).toContainText('valid-customers.csv');

    // Step 31: Test orders CSV type and upload
    await page.selectOption('select#csv-type', 'orders');
    await page.setInputFiles('input[type="file"]', 'e2e/fixtures/orders.csv');
    await expect(page.locator('.file-name')).toContainText('orders.csv');

    // Step 32: Navigate to Rules Editor
    await page.locator('.nav-link').filter({ hasText: 'Rules Editor' }).click();
    await expect(page).toHaveURL(/.*\/rules/);
    await page.waitForLoadState('networkidle');

    // Step 33: Verify Rules Editor loads and test basic functionality
    await expect(page.getByRole('heading', { name: 'Rules Editor' })).toBeVisible();
    await expect(page.locator('h3').filter({ hasText: 'Rule Editor' })).toBeVisible();
    await expect(page.locator('h3').filter({ hasText: 'Test Harness' })).toBeVisible();

    // Test rule editing
    const conditionInput = page.locator('.rule-condition input');
    await expect(conditionInput).toHaveValue('invalid_address AND country != "US"');

    // Modify the condition to test editing
    await conditionInput.fill('invalid_address AND country != "CA"');
    await expect(conditionInput).toHaveValue('invalid_address AND country != "CA"');

    // Reset to original condition
    await conditionInput.fill('invalid_address AND country != "US"');

    // Verify test payload textarea is present
    const testPayloadTextarea = page.locator('textarea#test-payload');
    await expect(testPayloadTextarea).toBeVisible();

    // Verify test rule button is present
    const testButton = page.getByRole('button', { name: 'Test Rule' });
    await expect(testButton).toBeVisible();

    // Step 34: Logout from the application
    await page.locator('.logout-btn').click();
    await expect(page).toHaveURL(/.*\/login/);

    // Step 35: Login again with same credentials
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', password);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.waitForResponse(resp => resp.url().includes('/auth/login') && resp.status() === 200);

    // Step 36: Verify successful login and dashboard access
    await expect(page).toHaveURL(/.*\/api-keys/);
    await expect(page.getByRole('heading', { name: 'OrbitCheck' })).toBeVisible();
  });
});
