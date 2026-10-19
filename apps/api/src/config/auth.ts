import type { FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from './env.js';

export type Role = 'GESTOR' | 'CONSULTOR' | 'INVESTIDOR';

/** 'full': the investor's own login token. 'agent': the short token apps/agent receives (see AGENT_SCOPE_ROUTES) */
export type Scope = 'full' | 'agent';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  scope: Scope;
}

export const AGENT_TOKEN_TTL_SECONDS = 3600;

/**
 * The only routes a token with scope "agent" may reach (method + Fastify route pattern). Deny by default:
 * anything else (mandate approval, mandate wallet, manager, user, payment, order writes, unknown paths) gets 403
 * before the handler runs, including handlers that decode the JWT themselves. Scope and role come from the
 * verified JWT and the database, never from the conversation.
 */
export const AGENT_SCOPE_ROUTES: ReadonlySet<string> = new Set([
  'GET /api/funds',
  'GET /api/funds/',
  'GET /api/funds/:id',
  'GET /api/orders',
  'GET /api/orders/',
  'GET /api/orders/holdings',
  'GET /api/badges/:userId',
  'GET /api/mandates',
  'GET /api/mandates/draft',
  'PUT /api/mandates/draft',
  'POST /api/agent/proposals',
  'POST /api/agent/proposals/:seq/execute',
  'GET /api/agent/eligibility/:fundId',
  'GET /api/decision-log',
  'GET /api/decision-log/verify',
]);

export function agentScopeAllows(method: string, routeUrl: string | undefined): boolean {
  return !!routeUrl && AGENT_SCOPE_ROUTES.has(`${method.toUpperCase()} ${routeUrl}`);
}

export function signAgentToken(user: { id: string; email: string; role: Role }): string {
  return jwt.sign({ id: user.id, email: user.email, role: user.role, scope: 'agent' }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: AGENT_TOKEN_TTL_SECONDS,
  });
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

/**
 * Global onRequest hook: decodes the Bearer token when present.
 * Requests without a token pass through (public routes); an invalid or expired token is rejected with 401.
 */
export async function authHook(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return;

  let payload: { id: string; scope?: unknown };
  try {
    payload = jwt.verify(header.slice('Bearer '.length), JWT_SECRET, {
      algorithms: ['HS256'],
    }) as { id: string; scope?: unknown };
  } catch {
    return reply.status(401).send({ error: 'Invalid or expired token' });
  }

  // The token only proves identity: role and approval are read from the database on every request,
  // so a pending, rejected or deleted account cannot act even with a token that has not expired yet
  const account = await request.server.prisma.user.findUnique({
    where: { id: payload.id },
    select: { id: true, email: true, role: true, status: true },
  });
  if (!account) {
    return reply.status(401).send({ error: 'Invalid or expired token' });
  }
  if (account.role !== 'GESTOR' && account.status !== 'APPROVED') {
    return reply.status(403).send({ error: 'Account pending approval' });
  }
  // Any scope claim other than "agent" is not a token we issue
  if (payload.scope !== undefined && payload.scope !== 'agent') {
    return reply.status(401).send({ error: 'Invalid or expired token' });
  }
  const scope: Scope = payload.scope === 'agent' ? 'agent' : 'full';
  if (scope === 'agent' && !agentScopeAllows(request.method, request.routeOptions?.url)) {
    return reply.status(403).send({ error: 'Not allowed with an agent token' });
  }
  request.user = { id: account.id, email: account.email, role: account.role as Role, scope };
}

/**
 * Returns the authenticated user, or sends 401/403 and returns null.
 * Usage: `const user = requireAuth(request, reply, ['GESTOR']); if (!user) return reply;`
 */
export function requireAuth(request: FastifyRequest, reply: FastifyReply, roles?: Role[]): AuthUser | null {
  if (!request.user) {
    reply.status(401).send({ error: 'Authentication required' });
    return null;
  }
  if (roles && !roles.includes(request.user.role)) {
    reply.status(403).send({ error: 'Access denied' });
    return null;
  }
  return request.user;
}

/**
 * Like requireAuth, and also requires the given scope. Use requireScope(request, reply, 'full', [...roles]) on
 * routes only the investor herself may call (approve the mandate, mint an agent token).
 */
export function requireScope(request: FastifyRequest, reply: FastifyReply, scope: Scope, roles?: Role[]): AuthUser | null {
  const user = requireAuth(request, reply, roles);
  if (!user) return null;
  if (scope === 'full' && user.scope !== 'full') {
    reply.status(403).send({ error: 'This action requires the investor herself, not the agent' });
    return null;
  }
  return user;
}
