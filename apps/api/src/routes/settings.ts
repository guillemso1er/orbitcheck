import { MGMT_V1_ROUTES } from '@orbicheck/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { generateRequestId, sendServerError } from './utils.js';

// Import route constants from contracts package
const ROUTES = {
    GET_SETTINGS: MGMT_V1_ROUTES.SETTINGS.GET_TENANT_SETTINGS,
    UPDATE_SETTINGS: MGMT_V1_ROUTES.SETTINGS.UPDATE_TENANT_SETTINGS,
};

export function registerSettingsRoutes(app: FastifyInstance, pool: Pool): void {
    // GET /v1/settings - Get tenant settings
    app.get(ROUTES.GET_SETTINGS, async (request: FastifyRequest, rep: FastifyReply) => {
        const request_id = generateRequestId();
        const project_id = (request as any).project_id;

        try {
            const result = await pool.query(
                'SELECT country_defaults, formatting, risk_thresholds FROM settings WHERE project_id = $1',
                [project_id]
            );

            if (result.rows.length === 0) {
                // Return default settings
                return rep.send({
                    country_defaults: {},
                    formatting: {},
                    risk_thresholds: {},
                    request_id,
                });
            }

            const settings = result.rows[0];
            return rep.send({
                country_defaults: settings.country_defaults,
                formatting: settings.formatting,
                risk_thresholds: settings.risk_thresholds,
                request_id,
            });
        } catch (error) {
            console.error('Error fetching settings:', error);
            return sendServerError(request, rep, error, ROUTES.GET_SETTINGS, request_id);
        }
    });

    // PUT /v1/settings - Update tenant settings
    app.put(ROUTES.UPDATE_SETTINGS, async (request: FastifyRequest<{ Body: { country_defaults?: object; formatting?: object; risk_thresholds?: object } }>, rep: FastifyReply) => {
        const request_id = generateRequestId();
        const project_id = (request as any).project_id;
        const { country_defaults = {}, formatting = {}, risk_thresholds = {} } = request.body;

        try {
            // Insert or update settings
            await pool.query(`
        INSERT INTO settings (project_id, country_defaults, formatting, risk_thresholds, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (project_id)
        DO UPDATE SET
          country_defaults = EXCLUDED.country_defaults,
          formatting = EXCLUDED.formatting,
          risk_thresholds = EXCLUDED.risk_thresholds,
          updated_at = NOW()
      `, [project_id, JSON.stringify(country_defaults), JSON.stringify(formatting), JSON.stringify(risk_thresholds)]);

            return rep.send({
                message: 'Settings updated successfully',
                request_id,
            });
        } catch (error) {
            console.error('Error updating settings:', error);
            return sendServerError(request, rep, error, ROUTES.UPDATE_SETTINGS, request_id);
        }
    });
}