import axios from 'axios';

/** #[contracterror] of contracts/mandate-wallet (numbers are fixed after M1) */
export const MANDATE_WALLET_ERRORS: Record<number, string> = {
  1: 'InvalidConfig',
  2: 'InvalidAmount',
  3: 'AgentRevoked',
  4: 'DecisionUsed',
  5: 'FundNotAllowed',
  6: 'OverTxCap',
  7: 'OverPeriodCap',
  8: 'OverFundCap',
  9: 'Math',
};

/** Finds "Error(Contract, #N)" (Soroban host error text) anywhere in a message or response body */
export function parseContractError(source: unknown): { code: number; name: string } | null {
  const text = typeof source === 'string' ? source : safeJson(source);
  const m = /Error\(Contract,\s*#(\d+)\)/.exec(text) ?? /contract error[^0-9#]*#?(\d+)/i.exec(text);
  if (!m) return null;
  const code = Number(m[1]);
  return { code, name: MANDATE_WALLET_ERRORS[code] ?? 'UnknownContractError' };
}

function safeJson(v: unknown): string {
  try {
    if (axios.isAxiosError(v)) return `${v.message} ${JSON.stringify(v.response?.data ?? '')}`;
    if (v instanceof Error) return v.message;
    return JSON.stringify(v) ?? '';
  } catch {
    return String(v);
  }
}

/** Human message of an API or wallet error, never a stack trace */
export function errorText(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const d = e.response?.data as { error?: string; reason?: string; message?: string } | undefined;
    const parts = [d?.error, d?.reason ?? d?.message].filter(Boolean);
    if (parts.length) return parts.join(': ');
    if (!e.response) return 'No response from the server';
    return `Request failed (${e.response.status})`;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

/** True when the request never got an answer (network down, server off): the state stays "pending, not done" */
export function isNoResponse(e: unknown): boolean {
  return axios.isAxiosError(e) && (!e.response || e.response.status >= 500);
}
