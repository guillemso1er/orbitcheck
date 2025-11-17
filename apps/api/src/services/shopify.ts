import type { Pool } from "pg";
import { decryptShopifyToken, encryptShopifyToken } from "../integrations/shopify/lib/crypto.js";
import { Mode } from "../integrations/shopify/lib/types.js";

export interface ShopifyShop {
    id: string;
    shop_domain: string;
    access_token: string;
    scopes: string[];
    installed_at: Date;
    updated_at: Date;
}

export interface ShopifySettings {
    id: string;
    shop_id: string;
    mode: Mode;
    created_at: Date;
    updated_at: Date;
}

export class ShopifyService {
    constructor(private pool: Pool) { }

    async storeShopToken(shopDomain: string, accessToken: string, scopes: string[]): Promise<void> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            // Insert or update shop
            const encryptedToken = encryptShopifyToken(accessToken);
            const shopResult = await client.query(`
        INSERT INTO shopify_shops (shop_domain, access_token, scopes)
        VALUES ($1, $2, $3)
        ON CONFLICT (shop_domain)
        DO UPDATE SET
          access_token = EXCLUDED.access_token,
          scopes = EXCLUDED.scopes,
          updated_at = now()
        RETURNING id
    `, [shopDomain, encryptedToken, scopes]);

            const shopId = shopResult.rows[0].id;

            // Insert default settings if not exists
            await client.query(`
        INSERT INTO shopify_settings (shop_id, mode)
        VALUES ($1, 'disabled')
        ON CONFLICT (shop_id) DO NOTHING
      `, [shopId]);

            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async getShopToken(shopDomain: string): Promise<{ access_token: string; scopes: string[] } | null> {
        const result = await this.pool.query(`
      SELECT access_token, scopes FROM shopify_shops WHERE shop_domain = $1
    `, [shopDomain]);

        if (result.rows.length === 0) {
            return null;
        }

        try {
            const decryptedToken = decryptShopifyToken(result.rows[0].access_token);
            return {
                access_token: decryptedToken,
                scopes: result.rows[0].scopes
            };
        } catch (error) {
            throw new Error('Failed to decrypt Shopify access token');
        }
    }

    async getShopMode(shopDomain: string): Promise<Mode> {
        if (!shopDomain || typeof shopDomain !== 'string') {
            throw new Error('Invalid shop domain provided to getShopMode: must be a non-empty string');
        }

        const result = await this.pool.query(`
      SELECT ss.mode FROM shopify_settings ss
      JOIN shopify_shops s ON s.id = ss.shop_id
      WHERE s.shop_domain = $1
    `, [shopDomain]);

        return result.rows.length > 0 ? result.rows[0].mode : 'disabled';
    }

    async recordGdprEvent(shopDomain: string, topic: string, payload: Record<string, unknown>): Promise<void> {
        if (!shopDomain || typeof shopDomain !== 'string') {
            throw new Error('Invalid shop domain provided to recordGdprEvent: must be a non-empty string');
        }

        const result = await this.pool.query(`
            INSERT INTO shopify_gdpr_events (shop_id, topic, payload)
            SELECT id, $2, $3 FROM shopify_shops WHERE shop_domain = $1
            RETURNING id
        `, [shopDomain, topic, payload]);

        console.log(`[ShopifyService] Recorded GDPR event ${topic} for ${shopDomain}, inserted: ${result.rowCount} rows`);
    }

    async setShopMode(shopDomain: string, mode: Mode): Promise<void> {
        if (!shopDomain || typeof shopDomain !== 'string') {
            throw new Error('Invalid shop domain provided to setShopMode: must be a non-empty string');
        }

        await this.pool.query(`
      UPDATE shopify_settings
      SET mode = $2, updated_at = now()
      WHERE shop_id = (
        SELECT id FROM shopify_shops WHERE shop_domain = $1
      )
    `, [shopDomain, mode]);
    }

    async deleteShopData(shopDomain: string): Promise<void> {
        if (!shopDomain || typeof shopDomain !== 'string') {
            throw new Error('Invalid shop domain provided to deleteShopData: must be a non-empty string');
        }

        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            // Delete shop - CASCADE will automatically delete settings and GDPR events
            const result = await client.query('DELETE FROM shopify_shops WHERE shop_domain = $1', [shopDomain]);

            console.log(`[ShopifyService] Deleted shop data for ${shopDomain}, rows affected: ${result.rowCount}`);

            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            console.error(`[ShopifyService] Failed to delete shop data for ${shopDomain}:`, error);
            throw error;
        } finally {
            client.release();
        }
    }

    async getCustomerData(shopDomain: string, customerId: string): Promise<Record<string, unknown> | null> {
        if (!shopDomain || typeof shopDomain !== 'string') {
            throw new Error('Invalid shop domain provided to getCustomerData: must be a non-empty string');
        }

        const result = await this.pool.query(`
            SELECT
                ss.id as shop_id,
                ss.shop_domain,
                ss.scopes,
                ss.installed_at,
                ss.updated_at,
                sgs.mode,
                sgs.created_at as settings_created_at,
                sgs.updated_at as settings_updated_at,
                sge.topic,
                sge.payload,
                sge.received_at
            FROM shopify_shops ss
            JOIN shopify_settings sgs ON ss.id = sgs.shop_id
            LEFT JOIN shopify_gdpr_events sge ON ss.id = sge.shop_id
            WHERE ss.shop_domain = $1
            AND sge.topic IN ('customers/data_request', 'customers/redact', 'shop/redact', 'app/uninstalled')
            ORDER BY sge.received_at DESC
        `, [shopDomain]);

        if (result.rows.length === 0) {
            return null;
        }

        // Group data by type
        const shopData = {
            id: result.rows[0].shop_id,
            domain: result.rows[0].shop_domain,
            scopes: result.rows[0].scopes,
            installed_at: result.rows[0].installed_at,
            updated_at: result.rows[0].updated_at
        };

        const settingsData = {
            mode: result.rows[0].mode,
            created_at: result.rows[0].settings_created_at,
            updated_at: result.rows[0].settings_updated_at
        };

        const gdprEvents = result.rows.map(row => ({
            topic: row.topic,
            payload: row.payload,
            received_at: row.received_at
        }));

        return {
            customer_id: customerId,
            shop: shopData,
            settings: settingsData,
            gdpr_events: gdprEvents,
            request_timestamp: new Date().toISOString(),
            data_source: 'orbitcheck_api'
        };
    }

    async sendCustomerDataToShopify(shopDomain: string, customerId: string, data: Record<string, unknown>): Promise<boolean> {
        if (!shopDomain || typeof shopDomain !== 'string') {
            throw new Error('Invalid shop domain provided to sendCustomerDataToShopify: must be a non-empty string');
        }

        const tokenData = await this.getShopToken(shopDomain);
        if (!tokenData) {
            return false;
        }

        try {
            // Note: Shopify doesn't have a built-in GraphQL mutation for customer data requests
            // In a real implementation, you would typically:
            // 1. Use Shopify's REST API to send data via a webhook response
            // 2. Or use a custom endpoint that Shopify can call to retrieve the data
            // 3. Or send the data via email or another agreed-upon channel

            // For now, we'll log the data that would be sent and return success
            // This simulates the data preparation step without making external calls

            console.log(`[Shopify GDPR] Would send data for customer ${customerId} from shop ${shopDomain}:`, {
                dataKeys: Object.keys(data),
                dataSize: JSON.stringify(data).length,
                timestamp: new Date().toISOString()
            });

            return true;
        } catch (error) {
            throw new Error(`Failed to prepare customer data for Shopify: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}

export function createShopifyService(pool: Pool): ShopifyService {
    return new ShopifyService(pool);
}