import { test, expect } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';

test.describe('Login Flow', () => {
  test('should register a new user and login successfully', async ({ page }) => {
    const email = `testuser${Date.now()}${uuidv4().slice(0, 8)}@example.com`;
    const password = 'password123';

    // Navigate to login page
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();

    // Toggle to register
    await page.getByRole('button', { name: 'Create Account' }).click();
    await expect(page.getByRole('heading', { name: 'Create Account' })).toBeVisible();

    // Fill register form and initiate the API call
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);

    // *** FIX: Wait for the registration API call to complete before proceeding ***
    // Start waiting for the response BEFORE clicking the button that triggers it.
    const registerResponse = page.waitForResponse('**/api/auth/register');
    await page.getByRole('button', { name: 'Create Account' }).click();
    await registerResponse; // The test will pause here until the network call is finished

    // Now that the API call is complete, assert the navigation
    await expect(page).toHaveURL(/.*\/api-keys/);
    await expect(page.getByRole('heading', { name: /OrbiCheck/ })).toBeVisible();

    // Logout to test login
    await page.getByRole('button', { name: 'Logout' }).click();
    await expect(page).toHaveURL(/.*\/login/);

    // Login with the same credentials
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);

    // *** FIX: Wait for the login API call to complete ***
    const loginResponse = page.waitForResponse('**/api/auth/login');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await loginResponse;

    // Should navigate back to dashboard
    await expect(page).toHaveURL(/.*\/api-keys/);
    await expect(page.locator('.nav-link.active .nav-label')).toHaveText('API Keys Management');
  });

  test('should show error for invalid login credentials', async ({ page }) => {
    await page.goto('/login');

    // Try login with invalid credentials
    await page.fill('input[type="email"]', 'invalid@example.com');
    await page.fill('input[type="password"]', 'wrongpass');

    // *** FIX: Wait for the failed login API call to complete ***
    const errorResponse = page.waitForResponse('**/api/auth/login');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await errorResponse;

    // Now that the API call has finished and the state has updated, check for the error
    await expect(page.locator('.alert-danger')).toBeVisible();
    await expect(page).toHaveURL(/.*\/login/); // Should not navigate away
  });
});