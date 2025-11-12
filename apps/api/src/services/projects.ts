import { DASHBOARD_ROUTES } from "@orbitcheck/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { HTTP_STATUS } from "../errors.js";
import type { CreateProjectData, CreateProjectResponses, DeleteProjectData, DeleteProjectResponses, GetUserProjectsResponses } from "../generated/fastify/types.gen.js";
import { createPlansService } from "./plans.js";
import { generateRequestId, sendServerError } from "./utils.js";

export async function getUserProjects(
    request: FastifyRequest,
    rep: FastifyReply,
    pool: Pool
): Promise<FastifyReply<{ Body: GetUserProjectsResponses }>> {
    try {
        const userId = (request as any).user_id;
        const request_id = generateRequestId();

        if (!userId) {
            return rep.status(HTTP_STATUS.UNAUTHORIZED).send({
                error: { code: 'UNAUTHORIZED', message: 'User not authenticated' }
            });
        }

        const { rows } = await pool.query(
            'SELECT id, name, created_at FROM projects WHERE user_id = $1 ORDER BY created_at DESC',
            [userId]
        );

        // Get user plan information
        const plansService = createPlansService(pool);
        const userPlan = await plansService.getUserPlan(userId);
        const currentProjects = rows.length;
        const projectsLimit = userPlan.plan.projectsLimit;

        const response: GetUserProjectsResponses[200] = {
            projects: rows,
            plan: {
                slug: userPlan.plan.slug,
                projectsLimit,
                currentProjects,
                canCreateMore: currentProjects < projectsLimit
            },
            request_id
        };
        return rep.send(response);
    } catch (error) {
        return sendServerError(request, rep, error, DASHBOARD_ROUTES.LIST_PROJECTS, generateRequestId());
    }
}

export async function createProject(
    request: FastifyRequest<{ Body: CreateProjectData['body'] }>,
    rep: FastifyReply,
    pool: Pool
): Promise<FastifyReply<{ Body: CreateProjectResponses }>> {
    try {
        const userId = (request as any).user_id;
        const request_id = generateRequestId();
        const body = request.body as CreateProjectData['body'];
        const { name } = body;

        if (!userId) {
            return rep.status(HTTP_STATUS.UNAUTHORIZED).send({
                error: { code: 'UNAUTHORIZED', message: 'User not authenticated' }
            });
        }

        if (!name || typeof name !== 'string' || name.trim() === '') {
            return rep.status(HTTP_STATUS.BAD_REQUEST).send({
                error: { code: 'BAD_REQUEST', message: 'Project name is required' }
            });
        }

        const { rows } = await pool.query(
            'INSERT INTO projects (name, user_id) VALUES ($1, $2) RETURNING id, name, created_at',
            [name.trim(), userId]
        );

        if (rows.length === 0) {
            return rep.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).send({
                error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create project' }
            });
        }

        const response: CreateProjectResponses[201] = { id: rows[0].id, name: rows[0].name, created_at: rows[0].created_at, request_id };
        return rep.status(HTTP_STATUS.CREATED).send(response);
    } catch (error) {
        return sendServerError(request, rep, error, DASHBOARD_ROUTES.CREATE_PROJECT, generateRequestId());
    }
}

export async function deleteProject(
    request: FastifyRequest<{ Params: DeleteProjectData['path'] }>,
    rep: FastifyReply,
    pool: Pool
): Promise<FastifyReply<{ Body: DeleteProjectResponses }>> {
    try {
        const userId = (request as any).user_id;
        const { id } = request.params as DeleteProjectData['path'];
        const request_id = generateRequestId();

        if (!userId) {
            return rep.status(HTTP_STATUS.UNAUTHORIZED).send({
                error: { code: 'UNAUTHORIZED', message: 'User not authenticated' }
            });
        }

        // Verify project belongs to user
        const projectCheck = await pool.query(
            'SELECT id FROM projects WHERE id = $1 AND user_id = $2',
            [id, userId]
        );

        if (projectCheck.rows.length === 0) {
            return rep.status(HTTP_STATUS.NOT_FOUND).send({
                error: { code: 'NOT_FOUND', message: 'Project not found or access denied' }
            });
        }

        await pool.query('DELETE FROM projects WHERE id = $1', [id]);

        const response: DeleteProjectResponses[200] = { message: 'Project deleted successfully', request_id };
        return rep.send(response);
    } catch (error) {
        return sendServerError(request, rep, error, DASHBOARD_ROUTES.DELETE_PROJECT, generateRequestId());
    }
}