import { expect, test } from '@playwright/test';
import crypto from 'crypto';
import { Pool } from 'pg';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/orbitcheck',
});

// Helper to encrypt Shopify token for test database
function encryptShopifyTokenForTest(token: string): string {
    const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0'.repeat(64);
    const KEY = Buffer.from(ENCRYPTION_KEY, 'hex');
    const ALGORITHM = 'aes-256-cbc';
    const IV_BYTES = 16;

    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
    const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

test.describe('Address Fix Validation', () => {
    test.beforeAll(async () => {
        // Ensure test shop exists
        await pool.query(`DELETE FROM shopify_shops WHERE shop_domain = $1`, ['test-shop.myshopify.com']);
        const encryptedToken = encryptShopifyTokenForTest('test-access-token');
        await pool.query(`
            INSERT INTO shopify_shops (shop_domain, access_token, scopes)
            VALUES ($1, $2, $3)
        `, ['test-shop.myshopify.com', encryptedToken, ['read_orders', 'write_orders']]);

        await pool.query(`
            INSERT INTO shopify_settings (shop_id, mode)
            SELECT id, 'activated' FROM shopify_shops WHERE shop_domain = $1
            ON CONFLICT (shop_id) DO UPDATE SET mode = 'activated'
        `, ['test-shop.myshopify.com']);
    });

    test('should display validation errors when submitting invalid address', async ({ page, context }) => {
        // Mock Shopify calls
        await context.route('https://test-shop.myshopify.com/admin/api/**', route => {
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ data: {} })
            });
        });

        // Create session
        const orderId = Math.floor(Math.random() * 1000000);
        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

        await pool.query(`
            INSERT INTO shopify_order_address_fixes (
                shop_domain, order_id, order_gid, customer_email,
                original_address, normalized_address, token_hash, token_expires_at, fix_status
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + INTERVAL '1 day', 'pending')
        `, [
            'test-shop.myshopify.com', orderId, `gid://shopify/Order/${orderId}`, 'test@example.com',
            JSON.stringify({ line1: '123 St', city: 'City', country: 'US' }), null, tokenHash
        ]);

        await page.goto(`http://localhost:5173/apps/address-fix?token=${token}`);

        // Select Edit Manually
        await page.locator('[role="radio"]:has-text("Edit Manually")').click();

        // Enter invalid data (triggers INVALID_INPUT_DATA)
        // Enter invalid data (triggers INVALID_INPUT_DATA)
        // Use :not([readonly]) to avoid selecting the read-only inputs in the "Original" card
        await page.locator('input[name="line1"]:not([readonly])').fill('asd');
        await page.locator('input[name="city"]:not([readonly])').fill('asd');
        await page.locator('input[name="postal_code"]:not([readonly])').fill('12345');
        await page.locator('input[name="state"]:not([readonly])').fill('NY');
        await page.locator('input[name="country"]:not([readonly])').fill('US');

        await page.getByRole('button', { name: /Confirm/i }).click();

        // Debug: Log page content
        await page.waitForTimeout(2000);
        const bodyText = await page.textContent('body');
        console.log('Page Content:', bodyText);

        // Verify error message
        await expect(page.getByText('Address validation failed: INVALID_INPUT_DATA')).toBeVisible({ timeout: 10000 });
    });

    test.afterAll(async () => {
        await pool.end();
    });
});
