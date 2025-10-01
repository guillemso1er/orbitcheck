import { test, expect } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';

test.describe('Login Flow', () => {
  test('should register a new user and login successfully', async ({ page }) => {
    const email = `testuser${Date.now()}${uuidv4().slice(0, 8)}@example.com`;
    const password = 'password123';

    // Navigate to login page
    await page.goto('/login');

    // Register new user
    await expect(page).toHaveURL(/.*\/login/);
    await page.getByRole('heading', { name: 'Welcome Back' }).waitFor({ state: 'visible' });

    // Toggle to register
    await page.getByRole('button', { name: 'Create Account' }).click();
    await expect(page.getByRole('heading', { name: 'Create Account' })).toBeVisible();

    // Fill register form
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.getByRole('button', { name: 'Create Account' }).click();

    // Wait for navigation to dashboard
    await expect(page).toHaveURL(/.*\/api-keys/);
    await expect(page.getByRole('heading', { name: /OrbiCheck/ })).toBeVisible();

    // Logout to test login
    await page.getByRole('button', { name: 'Logout' }).click();
    await expect(page).toHaveURL(/.*\/login/);

    // Login with the same credentials
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.getByRole('button', { name: 'Sign In' }).click();

    // Should navigate back to dashboard
    await expect(page).toHaveURL(/.*\/api-keys/);
    await expect(page.locator('.nav-link.active .nav-label')).toHaveText('API Keys Management');
  });

  test('should show error for invalid login credentials', async ({ page }) => {
    await page.goto('/login');

    // Try login with invalid credentials
    await page.fill('input[type="email"]', 'invalid@example.com');
    await page.fill('input[type="password"]', 'wrongpass');
    await page.getByRole('button', { name: 'Sign In' }).click();

    // Should show error
    await expect(page.locator('.alert-danger')).toBeVisible();
    await expect(page).toHaveURL(/.*\/login/); // Should not navigate away
  });
});