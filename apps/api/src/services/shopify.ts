import type { Pool } from "pg";

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
            const shopResult = await client.query(`
        INSERT INTO shopify_shops (shop_domain, access_token, scopes)
        VALUES ($1, $2, $3)
        ON CONFLICT (shop_domain)
        DO UPDATE SET
          access_token = EXCLUDED.access_token,
          scopes = EXCLUDED.scopes,
          updated_at = now()
        RETURNING id
      `, [shopDomain, accessToken, scopes]);

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

        return {
            access_token: result.rows[0].access_token,
            scopes: result.rows[0].scopes
        };
    }

    async getShopMode(shopDomain: string): Promise<Mode> {
        const result = await this.pool.query(`
      SELECT s.mode FROM shopify_settings ss
      JOIN shopify_shops s ON s.id = ss.shop_id
      WHERE s.shop_domain = $1
    `, [shopDomain]);

        return result.rows.length > 0 ? result.rows[0].mode : 'disabled';
    }

    async setShopMode(shopDomain: string, mode: Mode): Promise<void> {
        await this.pool.query(`
      UPDATE shopify_settings
      SET mode = $2, updated_at = now()
      WHERE shop_id = (
        SELECT id FROM shopify_shops WHERE shop_domain = $1
      )
    `, [shopDomain, mode]);
    }

    async deleteShopData(shopDomain: string): Promise<void> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            // Delete settings first (due to foreign key)
            await client.query(`
        DELETE FROM shopify_settings
        WHERE shop_id IN (
          SELECT id FROM shopify_shops WHERE shop_domain = $1
        )
      `, [shopDomain]);

            // Delete shop
            await client.query('DELETE FROM shopify_shops WHERE shop_domain = $1', [shopDomain]);

            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}

export function createShopifyService(pool: Pool): ShopifyService {
    return new ShopifyService(pool);
}