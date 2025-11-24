import { expect, test } from '@playwright/test';
import crypto from 'crypto';
import { Pool } from 'pg';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/orbitcheck',
});

// Helper to encrypt Shopify token for test database
function encryptShopifyTokenForTest(token: string): string {
    // Use a fixed encryption key for tests - matches what the API server would generate
    // In real production, this would come from environment variables
    const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0'.repeat(64); // 32 bytes = 64 hex chars
    const KEY = Buffer.from(ENCRYPTION_KEY, 'hex');
    const ALGORITHM = 'aes-256-cbc';
    const IV_BYTES = 16;

    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
    const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

test.describe('Address Fix Flow', () => {
    test.beforeAll(async () => {
        // Delete and recreate the shop to ensure fresh encryption
        await pool.query(`DELETE FROM shopify_shops WHERE shop_domain = $1`, ['test-shop.myshopify.com']);

        // Encrypt the test access token
        const encryptedToken = encryptShopifyTokenForTest('test-access-token');

        // Ensure test shop exists in database with encrypted token
        await pool.query(`
            INSERT INTO shopify_shops (shop_domain, access_token, scopes)
            VALUES ($1, $2, $3)
        `, ['test-shop.myshopify.com', encryptedToken, ['read_orders', 'write_orders']]);

        // Ensure shop has settings
        await pool.query(`
            INSERT INTO shopify_settings (shop_id, mode)
            SELECT id, 'activated' FROM shopify_shops WHERE shop_domain = $1
            ON CONFLICT (shop_id) DO UPDATE SET mode = 'activated'
        `, ['test-shop.myshopify.com']);
    });

    test('should handle invalid address, allow manual fix, and verify update', async ({ page, request, context }) => {
        // Mock Shopify GraphQL API calls
        await context.route('https://test-shop.myshopify.com/admin/api/**', route => {
            const postData = route.request().postDataJSON();
            console.log('Intercepted Shopify GraphQL call:', postData?.query?.substring(0, 50));

            // Return success for all GraphQL mutations
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: {
                        orderUpdate: { userErrors: [] },
                        fulfillmentOrderReleaseHold: { userErrors: [] },
                        tagsRemove: { userErrors: [] },
                        metafieldsDelete: { userErrors: [] }
                    }
                })
            });
        });

        // 1. Directly create a session in the database with a known token
        // This simulates what the webhook would do, but gives us control over the token
        const orderId = Math.floor(Math.random() * 1000000);
        const orderGid = `gid://shopify/Order/${orderId}`;
        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        const originalAddress = {
            line1: '123 Invalid St',
            city: 'Nowhere',
            state: 'NY',
            postal_code: '00000',
            country: 'US',
            first_name: 'John',
            last_name: 'Doe'
        };

        const insertResult = await pool.query(`
            INSERT INTO shopify_order_address_fixes (
                shop_domain, order_id, order_gid, customer_email,
                original_address, normalized_address, token_hash, token_expires_at, fix_status
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
            RETURNING id
        `, [
            'test-shop.myshopify.com',
            orderId,
            orderGid,
            'test@example.com',
            JSON.stringify(originalAddress),
            null,
            tokenHash,
            expiresAt
        ]);

        const sessionId = insertResult.rows[0].id;
        console.log(`Created session ${sessionId} with token`);

        // 2. Open Link to Dashboard
        console.log(`Opening page with token: ${token.substring(0, 16)}...`);

        // Listen for API responses before navigating
        page.on('response', response => {
            if (response.url().includes('address-fix')) {
                console.log(`API Response: ${response.status()} ${response.url()}`);
                if (response.status() !== 200) {
                    response.text().then(text => console.log('Error response:', text)).catch(() => { });
                }
            }
        });

        await page.goto(`/apps/address-fix?token=${token}`);

        // Wait a bit for page to load
        await page.waitForTimeout(2000);

        // Log what's actually on the page
        const bodyText = await page.textContent('body');
        console.log('Page title/heading:', bodyText?.substring(0, 200));

        // 3. Manually Fix Address
        // Expect to see the form
        await expect(page.getByText('Verify Shipping Address')).toBeVisible({ timeout: 10000 });

        // Click the "Edit Manually" option to show the form
        // Use role=radio since the AddressCard has role="radio"
        const editCard = page.locator('[role="radio"]:has-text("Edit Manually")');
        await editCard.click();

        // Wait for form to be visible with longer timeout for animation
        await page.waitForTimeout(1000);

        // Use more specific selectors - the input has a name attribute
        await page.locator('input[name="line1"]').fill('123 Main St');
        await page.locator('input[name="city"]').fill('New York');
        await page.locator('input[name="postal_code"]').fill('10001');
        await page.locator('input[name="state"]').fill('NY');
        await page.locator('input[name="country"]').fill('US');

        // Submit - look for button with Confirm text

        // Listen for console errors
        page.on('console', msg => {
            if (msg.type() === 'error') {
                console.log('Browser console error:', msg.text());
            }
        });

        // Listen for network responses
        page.on('response', response => {
            if (response.url().includes('address-fix') && response.status() !== 200) {
                console.log(`API Error: ${response.status()} ${response.url()}`);
                response.text().then(text => console.log('Response body:', text)).catch(() => { });
            }
        });

        await page.getByRole('button', { name: /Confirm/i }).click();

        // Wait a bit for the request to complete
        await page.waitForTimeout(3000);

        // Try to get any error text on the page
        const pageText = await page.textContent('body');
        console.log('Page contains error keywords:',
            pageText?.includes('error') || pageText?.includes('failed') || pageText?.includes('wrong'));

        // 4. Verify Success
        await expect(page.getByText('Address Confirmed!')).toBeVisible({ timeout: 10000 });

        // Verify in Database
        const updatedSessionResult = await pool.query(
            `SELECT * FROM shopify_order_address_fixes WHERE id = $1`,
            [sessionId]
        );
        const updatedSession = updatedSessionResult.rows[0];
        expect(updatedSession.fix_status).toBe('confirmed');
    });

    test.afterAll(async () => {
        await pool.end();
    });
});
