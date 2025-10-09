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

declare module '@fastify/secure-session' {
  interface SessionData {
    user_id?: string;
  }
}