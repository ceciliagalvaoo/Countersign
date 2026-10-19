// Result rows, rates and Markdown tables. Denominators are always ALL defined cases (12 and 12): a case that did not
// run counts as not blocked / not completed, and is listed with its reason. Nothing is ever reported as passed
// without having run.
export type Layer = 'policy' | 'contract' | 'api-scope' | 'agent';
export type AdvStatus = 'BLOCKED' | 'NOT BLOCKED' | 'NOT RUN' | 'ERROR';
export type BenignStatus = 'PASS' | 'FAIL' | 'NOT RUN' | 'ERROR';

export interface TxRef {
  label: string;
  hash: string;
  status: 'SUCCESS' | 'FAILED';
  link: string;
  /** what this hash proves, and what is consensus versus RPC diagnostics */
  note?: string;
  logSeq?: number | null;
}

export interface AdvRow {
  id: string;
  family: string;
  vector: string;
  expected: string;
  obtained: string;
  layer: Layer | null;
  /** policy rule name, HTTP status, or contract error with how it was read */
  ruleOrError: string;
  /** decision log row (seq and hash) when the policy wrote one */
  logLine: string;
  /** kind of proof: "simulation", "failed tx hash", "policy log row", "http 403" ... */
  proof: string;
  hashes: TxRef[];
  status: AdvStatus;
  notRunReason?: string;
  details?: unknown;
}

export interface BenignRow {
  id: string;
  task: string;
  expected: string;
  obtained: string;
  turns: number | null;
  hashes: TxRef[];
  status: BenignStatus;
  notRunReason?: string;
  details?: unknown;
}

const cell = (s: unknown) =>
  String(s ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ')
    .trim() || ' ';
const short = (h: string) => `${h.slice(0, 8)}...${h.slice(-4)}`;
const hashCell = (hs: TxRef[]) => (hs.length ? hs.map((h) => `[${short(h.hash)}](${h.link}) ${h.status}`).join('<br>') : 'none');

export function adversarialTable(rows: AdvRow[]) {
  const head =
    '| Case | Family | Vector | Expected | Obtained | Layer that blocked | Rule or contract error | Log line | Proof | Hash | Result |\n' +
    '|---|---|---|---|---|---|---|---|---|---|---|';
  const body = rows.map((r) =>
    [
      r.id,
      r.family,
      r.vector,
      r.expected,
      r.status === 'NOT RUN' ? `NOT RUN: ${r.notRunReason}` : r.obtained,
      r.layer ?? 'none',
      r.ruleOrError,
      r.logLine,
      r.proof,
      hashCell(r.hashes),
      r.status,
    ]
      .map(cell)
      .join(' | ')
  );
  return [head, ...body.map((b) => `| ${b} |`)].join('\n');
}

export function benignTable(rows: BenignRow[]) {
  const head = '| Task | Description | Expected | Obtained | Turns | Hash | Passed |\n|---|---|---|---|---|---|---|';
  const body = rows.map((r) =>
    [
      r.id,
      r.task,
      r.expected,
      r.status === 'NOT RUN' ? `NOT RUN: ${r.notRunReason}` : r.obtained,
      r.turns ?? 'n/a',
      hashCell(r.hashes),
      r.status === 'PASS' ? 'yes' : r.status === 'NOT RUN' ? 'NOT RUN' : 'no',
    ]
      .map(cell)
      .join(' | ')
  );
  return [head, ...body.map((b) => `| ${b} |`)].join('\n');
}

export function adversarialRates(rows: AdvRow[]) {
  const total = rows.length;
  const blocked = rows.filter((r) => r.status === 'BLOCKED').length;
  const byContract = rows.filter((r) => r.status === 'BLOCKED' && r.layer === 'contract').length;
  const byLayer: Record<string, number> = {};
  for (const r of rows) if (r.status === 'BLOCKED' && r.layer) byLayer[r.layer] = (byLayer[r.layer] ?? 0) + 1;
  const notRun = rows.filter((r) => r.status === 'NOT RUN').map((r) => r.id);
  const notBlocked = rows.filter((r) => r.status === 'NOT BLOCKED' || r.status === 'ERROR').map((r) => r.id);
  const failedTxHashes = rows.filter((r) => r.layer === 'contract').flatMap((r) => r.hashes.filter((h) => h.status === 'FAILED')).length;
  return {
    total,
    blocked,
    blockRate: total ? blocked / total : 0,
    blockedByContract: byContract,
    blockedByLayer: byLayer,
    failedTxHashesFromContractRefusals: failedTxHashes,
    notRun,
    notBlockedOrError: notBlocked,
    executed: total - notRun.length,
  };
}

export function benignRates(rows: BenignRow[]) {
  const total = rows.length;
  const passed = rows.filter((r) => r.status === 'PASS').length;
  const ran = rows.filter((r) => r.status !== 'NOT RUN' && r.turns !== null);
  const avgTurns = ran.length ? ran.reduce((a, r) => a + (r.turns ?? 0), 0) / ran.length : null;
  return {
    total,
    passed,
    completionRate: total ? passed / total : 0,
    averageTurns: avgTurns,
    averageTurnsOver: ran.length,
    notRun: rows.filter((r) => r.status === 'NOT RUN').map((r) => r.id),
    failedOrError: rows.filter((r) => r.status === 'FAIL' || r.status === 'ERROR').map((r) => r.id),
  };
}

export const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
