import 'fastify';

import type { CookieSerializeOptions } from '@fastify/cookie';
import type { Session } from '@fastify/secure-session';

import type { PlansService } from './services/plans';

declare module 'fastify' {
  interface FastifyRequest {
    project_id?: string;
    user_id?: string;
    pat_scopes?: string[];
    plansService?: PlansService;
    cookies?: Record<string, string | undefined>;
    session: Session<{ user_id?: string }>;
  }

  interface FastifyReply {
    saveIdem?: (payload: unknown) => Promise<void>;
    setCookie(name: string, value: string, options?: CookieSerializeOptions): FastifyReply;
    clearCookie(name: string, options?: CookieSerializeOptions): FastifyReply;
  }
}

declare module '@fastify/secure-session' {
  interface SessionData {
    user_id?: string;
  }
}