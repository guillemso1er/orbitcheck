import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Pool } from "pg";
import crypto from "crypto";
import { env } from "../env";

export async function verifyJWT(req: FastifyRequest, rep: FastifyReply, pool: Pool) {
    const header = req.headers["authorization"];
    if (!header || !header.startsWith("Bearer ")) {
        return rep.status(401).send({ error: { code: "unauthorized", message: "Missing JWT token" } });
    }
    const token = header.substring(7).trim();

    try {
        const decoded = jwt.verify(token, env.JWT_SECRET) as { user_id: string };
        const { rows } = await pool.query('SELECT id FROM users WHERE id = $1', [decoded.user_id]);
        if (rows.length === 0) {
            return rep.status(401).send({ error: { code: "invalid_token", message: "Invalid token" } });
        }
        (req as any).user_id = decoded.user_id;

        // Get default project for user
        const { rows: projectRows } = await pool.query(
            'SELECT p.id as project_id FROM projects p WHERE p.user_id = $1 AND p.name = $2',
            [decoded.user_id, 'Default Project']
        );
        if (projectRows.length === 0) {
            return rep.status(403).send({ error: { code: "no_project", message: "No default project found" } });
        }
        (req as any).project_id = projectRows[0].project_id;
    } catch (err) {
        return rep.status(401).send({ error: { code: "invalid_token", message: "Invalid or expired token" } });
    }
}

export function registerAuthRoutes(app: FastifyInstance, pool: Pool) {
    app.post('/auth/register', {
        schema: {
            body: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                    email: { type: 'string', format: 'email' },
                    password: { type: 'string', minLength: 8 }
                }
            },
            response: {
                201: {
                    type: 'object',
                    properties: {
                        token: { type: 'string' },
                        user: {
                            type: 'object',
                            properties: {
                                id: { type: 'string' },
                                email: { type: 'string' }
                            }
                        }
                    }
                },
                400: { description: 'Invalid input' },
                409: { description: 'User already exists' }
            }
        }
    }, async (req, rep) => {
        const { email, password } = req.body as { email: string; password: string };
        const hashedPassword = await bcrypt.hash(password, 12);

        try {
            // Create user
            const { rows: userRows } = await pool.query(
                'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
                [email, hashedPassword]
            );

            if (userRows.length === 0) {
                return rep.status(409).send({ error: { code: 'user_exists', message: 'User already exists' } });
            }

            const user = userRows[0];

            // Create default project for user
            const { rows: projectRows } = await pool.query(
                'INSERT INTO projects (name, plan, user_id) VALUES ($1, $2, $3) RETURNING id',
                ['Default Project', 'dev', user.id]
            );

            const projectId = projectRows[0].id;

            // Generate default API key
            const fullKey = "ok_" + crypto.randomBytes(32).toString('hex');
            const prefix = fullKey.slice(0, 6);
            const keyHash = crypto.createHash('sha256').update(fullKey).digest('hex');

            await pool.query(
                "INSERT INTO api_keys (project_id, prefix, hash, status, name) VALUES ($1, $2, $3, 'active', $4)",
                [projectId, prefix, keyHash, 'Default API Key']
            );

            // Generate JWT
            const token = jwt.sign({ user_id: user.id }, env.JWT_SECRET, { expiresIn: '7d' });

            return rep.status(201).send({ token, user });
        } catch (err) {
            if ((err as any).code === '23505') { // Unique violation
                return rep.status(409).send({ error: { code: 'user_exists', message: 'User already exists' } });
            }
            throw err;
        }
    });

    app.post('/auth/login', {
        schema: {
            body: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                    email: { type: 'string', format: 'email' },
                    password: { type: 'string' }
                }
            },
            response: {
                200: {
                    type: 'object',
                    properties: {
                        token: { type: 'string' },
                        user: {
                            type: 'object',
                            properties: {
                                id: { type: 'string' },
                                email: { type: 'string' }
                            }
                        }
                    }
                },
                401: { description: 'Invalid credentials' }
            }
        }
    }, async (req, rep) => {
        const { email, password } = req.body as { email: string; password: string };

        const { rows } = await pool.query('SELECT id, password_hash FROM users WHERE email = $1', [email]);

        if (rows.length === 0 || !(await bcrypt.compare(password, rows[0].password_hash))) {
            return rep.status(401).send({ error: { code: 'invalid_credentials', message: 'Invalid email or password' } });
        }

        const user = rows[0];
        const token = jwt.sign({ user_id: user.id }, env.JWT_SECRET, { expiresIn: '7d' });

        return rep.send({ token, user: { id: user.id, email } });
    });
}