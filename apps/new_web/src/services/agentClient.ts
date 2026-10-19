import axios, { type AxiosRequestConfig } from 'axios';
import { agentTokenService } from './countersign';
import type { AgentSessionView, RecurringResponse } from '../types/countersign';

/**
 * Client of apps/agent. It authenticates ONLY with the agent scope token (1 h) minted by
 * POST /api/agent/session-token; the investor's full JWT never leaves for the agent service.
 * The token is renewed five minutes before it expires, and once more on a 401.
 */

export const AGENT_URL = import.meta.env.VITE_AGENT_URL || 'http://localhost:3002';

const agentHttp = axios.create({ baseURL: AGENT_URL, headers: { 'Content-Type': 'application/json' } });

const RENEW_MARGIN_MS = 5 * 60 * 1000;
let cached: { token: string; expiresAt: number; userId: string } | null = null;
let inflight: Promise<string> | null = null;

async function agentToken(force = false): Promise<string> {
  if (!force && cached && cached.expiresAt - Date.now() > RENEW_MARGIN_MS) return cached.token;
  if (inflight) return inflight;
  inflight = agentTokenService
    .mint()
    .then((r) => {
      cached = { token: r.token, expiresAt: Date.now() + r.expiresIn * 1000, userId: r.userId };
      return r.token;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Forget the token (logout or user switch) */
export function clearAgentToken() {
  cached = null;
}

async function call<T>(config: AxiosRequestConfig): Promise<T> {
  const send = async (token: string) =>
    (await agentHttp.request<T>({ ...config, headers: { ...(config.headers ?? {}), Authorization: `Bearer ${token}` } })).data;
  try {
    return await send(await agentToken());
  } catch (e) {
    if (axios.isAxiosError(e) && e.response?.status === 401) return send(await agentToken(true));
    throw e;
  }
}

export interface ChatResponse extends AgentSessionView {
  reply: string;
  turn: number;
  flags?: string[];
  toolCalls?: unknown[];
}

export const agentClient = {
  chat: (sessionId: string, message: string) => call<ChatResponse>({ method: 'POST', url: '/chat', data: { sessionId, message } }),
  session: async (sessionId: string): Promise<AgentSessionView | null> => {
    try {
      return await call<AgentSessionView>({ method: 'GET', url: `/session/${encodeURIComponent(sessionId)}` });
    } catch (e) {
      if (axios.isAxiosError(e) && e.response?.status === 404) return null;
      throw e;
    }
  },
  interrupt: (sessionId: string) => call<AgentSessionView>({ method: 'POST', url: `/session/${encodeURIComponent(sessionId)}/interrupt` }),
  resume: (sessionId: string) => call<AgentSessionView>({ method: 'POST', url: `/session/${encodeURIComponent(sessionId)}/resume` }),
  recurring: (sessionId: string, fundId?: string) =>
    call<RecurringResponse>({ method: 'POST', url: `/session/${encodeURIComponent(sessionId)}/recurring`, data: fundId ? { fundId } : {} }),
};
