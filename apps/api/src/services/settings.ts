import { MGMT_V1_ROUTES } from "@orbitcheck/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import type { GetSettingsResponses, UpdateSettingsData, UpdateSettingsResponses } from "../generated/fastify/types.gen.js";
import { generateRequestId, sendServerError } from "./utils.js";

export async function getTenantSettings(
    request: FastifyRequest,
    rep: FastifyReply,
    pool: Pool
): Promise<FastifyReply> {
    const request_id = generateRequestId();
    const project_id = (request as any).project_id;

    try {
        const result = await pool.query(
            'SELECT country_defaults, formatting, risk_thresholds FROM settings WHERE project_id = $1',
            [project_id]
        );

        if (result.rows.length === 0) {
            const response: GetSettingsResponses[200] = {
                country_defaults: {},
                formatting: {},
                risk_thresholds: {},
                request_id,
            };
            return rep.send(response);
        }

        const settings = result.rows[0];
        const response: GetSettingsResponses[200] = {
            country_defaults: settings.country_defaults,
            formatting: settings.formatting,
            risk_thresholds: settings.risk_thresholds,
            request_id,
        };
        return rep.send(response);
    } catch (error) {
        console.error('Error fetching settings:', error);
        return sendServerError(request, rep, error, MGMT_V1_ROUTES.SETTINGS.GET_TENANT_SETTINGS, request_id);
    }
}

export async function updateTenantSettings(
    request: FastifyRequest<{ Body: UpdateSettingsData['body'] }>,
    rep: FastifyReply,
    pool: Pool
): Promise<FastifyReply> {
    const request_id = generateRequestId();
    const project_id = (request as any).project_id;
    const { country_defaults = {}, formatting = {}, risk_thresholds = {} } = request.body;

    try {
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

        const response: UpdateSettingsResponses[200] = {
            message: 'Settings updated successfully',
            request_id,
        };
        return rep.send(response);
    } catch (error) {
        console.error('Error updating settings:', error);
        return sendServerError(request, rep, error, MGMT_V1_ROUTES.SETTINGS.UPDATE_TENANT_SETTINGS, request_id);
    }
}