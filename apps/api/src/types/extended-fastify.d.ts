import { FastifyReply,FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    project_id?: string;
    user_id?: string;
  }

  interface FastifyReply {
    saveIdem?: (payload: unknown) => Promise<void>;
  }
}