import { DASHBOARD_ROUTES } from '@orbitcheck/contracts';
import { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { createPlansService } from '../services/plans.js';
import { HTTP_STATUS } from '../errors.js';

export function registerProjectRoutes(app: FastifyInstance, pool: Pool): void {
  const plansService = createPlansService(pool);

  // GET /projects - List user's projects
  app.get(DASHBOARD_ROUTES.LIST_USERS_PROJECTS, {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            projects: {
              type: 'array',
              items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      name: { type: 'string' },
                      created_at: { type: 'string' }
                    }
                  }
            },
            plan: {
              type: 'object',
              properties: {
                slug: { type: 'string' },
                projectsLimit: { type: 'number' },
                currentProjects: { type: 'number' },
                canCreateMore: { type: 'boolean' }
              }
            }
          }
        },
        401: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', enum: ['UNAUTHORIZED'] },
                message: { type: 'string' }
              }
            }
          }
        },
        500: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', enum: ['INTERNAL_SERVER_ERROR'] },
                message: { type: 'string' }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const userId = request.user_id;
      if (!userId) {
        return reply.status(HTTP_STATUS.UNAUTHORIZED).send({
          error: { code: 'UNAUTHORIZED', message: 'User not authenticated' }
        });
      }

      const projects = await pool.query(
        'SELECT id, name, created_at FROM projects WHERE user_id = $1 ORDER BY created_at DESC',
        [userId]
      );

      const userPlan = await plansService.getUserPlan(userId);
      const currentProjects = projects.rows.length;
      const projectsLimit = userPlan.plan.projectsLimit;

      return reply.send({
        projects: projects.rows,
        plan: {
          slug: userPlan.plan.slug,
          projectsLimit,
          currentProjects,
          canCreateMore: currentProjects < projectsLimit
        }
      });
    } catch (error) {
      request.log.error({ error }, 'Failed to fetch projects');
      return reply.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).send({
        error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch projects' }
      });
    }
  });

  // POST /projects - Create new project
  app.post(DASHBOARD_ROUTES.CREATE_NEW_PROJECT, {
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' }
        }
      },
      response: {
        201: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            created_at: { type: 'string' }
          }
        },
        400: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', enum: ['INVALID_INPUT'] },
                message: { type: 'string' }
              }
            }
          }
        },
        401: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', enum: ['UNAUTHORIZED'] },
                message: { type: 'string' }
              }
            }
          }
        },
        402: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', enum: ['LIMIT_EXCEEDED'] },
                message: { type: 'string' }
              }
            },
            plan: {
              type: 'object',
              properties: {
                slug: { type: 'string' },
                projectsLimit: { type: 'number' },
                currentProjects: { type: 'number' }
              }
            }
          }
        },
        500: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', enum: ['INTERNAL_SERVER_ERROR'] },
                message: { type: 'string' }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const userId = request.user_id;
      if (!userId) {
        return reply.status(HTTP_STATUS.UNAUTHORIZED).send({
          error: { code: 'UNAUTHORIZED', message: 'User not authenticated' }
        });
      }

      const { name } = request.body as any;
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return reply.status(HTTP_STATUS.BAD_REQUEST).send({
          error: { code: 'INVALID_INPUT', message: 'Project name is required' }
        });
      }

      // Check project limit
      const userPlan = await plansService.getUserPlan(userId);
      const currentProjects = await pool.query(
        'SELECT COUNT(*) as count FROM projects WHERE user_id = $1',
        [userId]
      );

      if (currentProjects.rows[0].count >= userPlan.plan.projectsLimit) {
        return reply.status(HTTP_STATUS.PAYMENT_REQUIRED).send({
          error: {
            code: 'LIMIT_EXCEEDED',
            message: `Project limit exceeded. Current plan allows ${userPlan.plan.projectsLimit} projects. Upgrade to create more.`
          },
          plan: {
            slug: userPlan.plan.slug,
            projectsLimit: userPlan.plan.projectsLimit,
            currentProjects: currentProjects.rows[0].count
          }
        });
      }

      // Create project
      const result = await pool.query(
        'INSERT INTO projects (name, user_id, created_at) VALUES ($1, $2, NOW()) RETURNING id, name, created_at',
        [name.trim(), userId]
      );

      return reply.status(HTTP_STATUS.CREATED).send(result.rows[0]);
    } catch (error) {
      request.log.error({ error }, 'Failed to create project');
      return reply.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).send({
        error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create project' }
      });
    }
  });

  // DELETE /projects/:id - Delete project
  app.delete(DASHBOARD_ROUTES.DELETE_PROJECT, {
    schema: {
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            message: { type: 'string' }
          }
        },
        401: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', enum: ['UNAUTHORIZED'] },
                message: { type: 'string' }
              }
            }
          }
        },
        404: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', enum: ['NOT_FOUND'] },
                message: { type: 'string' }
              }
            }
          }
        },
        500: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', enum: ['INTERNAL_SERVER_ERROR'] },
                message: { type: 'string' }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const userId = request.user_id;
      const { id } = request.params as any;

      if (!userId) {
        return reply.status(HTTP_STATUS.UNAUTHORIZED).send({
          error: { code: 'UNAUTHORIZED', message: 'User not authenticated' }
        });
      }

      // Verify project belongs to user
      const projectCheck = await pool.query(
        'SELECT id FROM projects WHERE id = $1 AND user_id = $2',
        [id, userId]
      );

      if (projectCheck.rows.length === 0) {
        return reply.status(HTTP_STATUS.NOT_FOUND).send({
          error: { code: 'NOT_FOUND', message: 'Project not found or access denied' }
        });
      }

      await pool.query('DELETE FROM projects WHERE id = $1', [id]);

      return reply.send({ message: 'Project deleted successfully' });
    } catch (error) {
      request.log.error({ error }, 'Failed to delete project');
      return reply.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).send({
        error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to delete project' }
      });
    }
  });
}