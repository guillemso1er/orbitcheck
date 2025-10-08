import { _FastifyReply } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    project_id?: string;
    user_id?: string;
    pat_scopes?: string[];
  }

  interface FastifyReply {
    saveIdem?: (payload: unknown) => Promise<void>;
  }
}

declare module '@fastify/session' {
  interface FastifySessionObject {
    user_id?: string;
  }
}