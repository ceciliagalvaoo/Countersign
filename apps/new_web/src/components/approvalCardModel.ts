import { argOf, type DecodedArg, type DecodedCall } from '../types/decodedCall';
import type { FundRef } from '../types/countersign';
import { CARD_FIRST_PURCHASE, NETWORK_LABEL } from '../constants/labels';
import { formatUnits, secondsToDays, shortAddress, shortHash } from '../utils/units';

/**
 * Pure mapping from a DecodedCall (and facts read by the API from the chain or the database, never from
 * the language model) to what the approval card shows. Kept apart from the component so the byte flip
 * test can compare two cards without a browser.
 */

export interface CardContext {
  /** Connected owner account (G...) */
  userPublicKey: string | null;
  /** The investor's mandate wallet contract (C...), read from GET /api/mandate-wallet */
  walletContractId: string | null;
  /** Agent key of the wallet (G...), read from the contract by the API */
  agentPublicKey?: string | null;
  /** USDC Stellar Asset Contract id computed from the configured asset */
  usdcContractId?: string | null;
  /** Funds from GET /api/funds, used only to name addresses found in the decoded arguments */
  funds: FundRef[];
  /** Current on-chain limits of the wallet, read by the API (for the loss scenario) */
  walletLimits?: { perTxCapUnits: string; periodCapUnits: string; periodSecs: number } | null;
  /** Planned first purchase from the policy's decision log (allow_fund only) */
  plannedPurchase?: { amountUnits: string; seq: number } | null;
  /** Who is signing: the investor (owner) or the fund's issuer (gestor pause) */
  audience?: 'investor' | 'issuer';
}

export interface CardLine {
  label: string;
  value: string;
  /** Explanation under the value */
  note?: string;
  /** Raw value (address or integer) shown small under the readable one */
  raw?: string;
}

export interface SignerLine {
  who: string;
  text: string;
  /** signs this transaction (amber until signed, then green) or only explains a role */
  signsThis: boolean;
}

export interface CardModel {
  title: string;
  intro: string | null;
  network: string;
  contract: { label: string; id: string | null; recognised: boolean; isMandateWallet: boolean };
  functionName: string;
  args: CardLine[];
  maxFee: string | null;
  signers: SignerLine[];
  loss: string[];
  showEnforced: boolean;
  showFundsLabel: boolean;
  planned: CardLine | null;
}

const ARG_LABELS: Record<string, string> = {
  fund_wallet: 'Fund wallet',
  fund_token: 'Fund unit token',
  fund_cap: 'Cap for this fund',
  per_tx_cap: 'Cap per purchase',
  period_cap: 'Cap per period',
  period_secs: 'Period',
  mandate_hash: 'Mandate hash',
  amount: 'Amount',
  decision: 'Decision',
  agent: 'Agent key',
  owner: 'Owner',
  usdc: 'USDC token',
  from: 'From',
  to: 'To',
  paused: 'Paused',
};

const USDC_ARGS = /cap|amount/;

function fundByAddress(ctx: CardContext, addr: string): FundRef | undefined {
  return ctx.funds.find((f) => f.fundWalletPublicKey === addr || f.tokenContractId === addr);
}

export function labelAddress(addr: string, ctx: CardContext): { label: string; recognised: boolean } {
  if (ctx.walletContractId && addr === ctx.walletContractId) return { label: 'Your mandate wallet', recognised: true };
  if (ctx.userPublicKey && addr === ctx.userPublicKey) return { label: ctx.audience === 'issuer' ? 'Fund wallet (you)' : 'You', recognised: true };
  if (ctx.agentPublicKey && addr === ctx.agentPublicKey) return { label: 'Agent key', recognised: true };
  if (ctx.usdcContractId && addr === ctx.usdcContractId) return { label: 'USDC token contract', recognised: true };
  const fund = fundByAddress(ctx, addr);
  if (fund) {
    return fund.fundWalletPublicKey === addr
      ? { label: `${fund.name} (fund wallet)`, recognised: true }
      : { label: `${fund.symbol} fund unit token`, recognised: true };
  }
  return { label: 'Unrecognised address', recognised: false };
}

function argLine(a: DecodedArg, ctx: CardContext): CardLine {
  const label = ARG_LABELS[a.name] ?? a.name;
  const t = a.type.toLowerCase();
  const v = a.value;
  if (/^[GC][A-Z2-7]{55}$/.test(v)) {
    const known = labelAddress(v, ctx);
    // Labels the API decoder attached come from its database (never from the language model)
    const name = known.recognised ? known.label : a.label ? a.label : known.label;
    return { label, value: name, raw: shortAddress(v) };
  }
  if ((t.includes('i128') || t.includes('u128')) && /^-?\d+$/.test(v) && a.display) {
    // The decoder knows the unit (USDC or fund units); the raw integer is shown under it
    return { label, value: a.display, raw: v };
  }
  if ((t.includes('i128') || t.includes('u128') || t === 'unknown') && /^-?\d+$/.test(v) && USDC_ARGS.test(a.name)) {
    return { label, value: `${formatUnits(v)} USDC`, raw: v };
  }
  if (a.name === 'period_secs' && /^\d+$/.test(v)) return { label, value: a.display || secondsToDays(v), raw: `${v} s` };
  if (/^[0-9a-f]{64}$/i.test(v)) return { label, value: shortHash(v.toLowerCase()), raw: undefined };
  if (t === 'bool' || v === 'true' || v === 'false') return { label, value: v === 'true' ? 'yes' : 'no' };
  return { label, value: a.display || v };
}

function titleOf(call: DecodedCall, ctx: CardContext): string {
  if (call.kind === 'deploy') return 'Create your mandate wallet';
  switch (call.function) {
    case 'allow_fund':
      return 'Approve a fund for your agent';
    case 'set_limits':
      return 'Anchor your mandate on-chain';
    case 'revoke_agent':
      return 'Revoke the agent';
    case 'disallow_fund':
      return 'Remove a fund from your allowlist';
    case 'withdraw':
      return 'Withdraw USDC from your mandate wallet';
    case 'transfer':
      return ctx.walletContractId && argOf(call, 'to', 1)?.value === ctx.walletContractId
        ? 'Deposit USDC into your mandate wallet'
        : 'USDC transfer';
    case 'set_pause':
      return argOf(call, 'paused', 0)?.value === 'false' ? 'Resume fund units' : 'Pause fund units';
    default:
      return `Contract call: ${call.function}`;
  }
}

function contractOf(call: DecodedCall, ctx: CardContext): CardModel['contract'] {
  if (call.kind === 'deploy') {
    return { label: 'New mandate wallet (our wallet contract)', id: null, recognised: true, isMandateWallet: true };
  }
  const id = call.contractId ?? '';
  const known = labelAddress(id, ctx);
  const isMandateWallet = !!ctx.walletContractId && id === ctx.walletContractId;
  if (known.recognised) return { label: known.label, id, recognised: true, isMandateWallet };
  if (call.contractLabel) return { label: call.contractLabel, id, recognised: true, isMandateWallet };
  return { label: 'Unrecognised contract', id, recognised: false, isMandateWallet };
}

function limitsText(ctx: CardContext): string | null {
  const l = ctx.walletLimits;
  if (!l) return null;
  return `in purchases of at most ${formatUnits(l.perTxCapUnits)} USDC and ${formatUnits(l.periodCapUnits)} USDC per ${secondsToDays(l.periodSecs)}`;
}

function signersOf(call: DecodedCall): SignerLine[] {
  if (call.function === 'set_pause') {
    return [{ who: 'Issuer', text: 'the fund wallet signs this pause', signsThis: true }];
  }
  const you: SignerLine = { who: 'You', text: 'your signature, in your wallet', signsThis: true };
  switch (call.function) {
    case 'allow_fund':
      return [
        you,
        { who: 'Agent', text: 'will buy only within these limits', signsThis: false },
        { who: 'Issuer', text: 'countersigns each mint', signsThis: false },
      ];
    case 'set_limits':
      return [you, { who: 'Agent', text: 'cannot change these limits', signsThis: false }];
    case 'revoke_agent':
      return [you, { who: 'Agent', text: 'loses the right to buy once this is confirmed', signsThis: false }];
    default:
      return [you];
  }
}

function lossOf(call: DecodedCall, ctx: CardContext): string[] {
  const out: string[] = [];
  if (call.kind === 'deploy') {
    out.push('No USDC moves in this transaction. It creates the contract that will hold your mandate.');
    return out;
  }
  switch (call.function) {
    case 'allow_fund': {
      const cap = argOf(call, 'fund_cap', 2)?.value;
      const wallet = argOf(call, 'fund_wallet', 0)?.value;
      const fund = wallet ? fundByAddress(ctx, wallet) : undefined;
      const name = fund ? fund.name : 'this fund wallet';
      const lim = limitsText(ctx);
      out.push(`The agent can pay ${name} up to ${cap ? formatUnits(cap) : '?'} USDC in total${lim ? `, ${lim}` : ''}.`);
      out.push("If the fund's receivables are not paid, its units can lose value, up to everything paid into the fund.");
      if (fund && typeof fund.maxSacadoConcentrationPercent === 'number') {
        out.push(`Largest account debtor: up to ${fund.maxSacadoConcentrationPercent}% of the fund.`);
      }
      return out;
    }
    case 'set_limits': {
      const per = argOf(call, 'per_tx_cap', 0)?.value;
      const period = argOf(call, 'period_cap', 1)?.value;
      const secs = argOf(call, 'period_secs', 2)?.value;
      out.push(
        `After this, the agent can spend at most ${per ? formatUnits(per) : '?'} USDC per purchase and ${period ? formatUnits(period) : '?'} USDC per ${secs ? secondsToDays(secs) : '?'}, only to fund wallets you approve one by one.`,
      );
      return out;
    }
    case 'transfer': {
      const amount = argOf(call, 'amount', 2)?.value;
      out.push(
        `${amount ? formatUnits(amount) : '?'} USDC moves into your mandate wallet. It leaves only through agent purchases within your limits to funds you approved, or through your own withdraw.`,
      );
      return out;
    }
    case 'revoke_agent':
      out.push('No USDC moves. After this, every purchase by the agent is refused by our wallet contract.');
      return out;
    case 'withdraw':
      out.push('USDC returns from your mandate wallet to your own account.');
      return out;
    case 'set_pause':
      out.push('While paused, units of this fund cannot be minted or transferred.');
      return out;
    default:
      out.push('This app does not recognise this call. Do not sign it unless you know what it does.');
      return out;
  }
}

export function buildCardModel(call: DecodedCall, ctx: CardContext): CardModel {
  const fn = call.function;
  const showEnforced = call.kind === 'deploy' || ['allow_fund', 'set_limits', 'transfer', 'revoke_agent'].includes(fn);
  const planned =
    fn === 'allow_fund' && ctx.plannedPurchase
      ? {
          label: 'Planned purchase',
          value: `${formatUnits(ctx.plannedPurchase.amountUnits)} USDC`,
          note: `Not part of this transaction. After your signature the agent sends it to the policy again; the new decision, not #${ctx.plannedPurchase.seq}, is what gets executed.`,
        }
      : null;
  return {
    title: titleOf(call, ctx),
    intro: fn === 'allow_fund' ? CARD_FIRST_PURCHASE : null,
    network: NETWORK_LABEL,
    contract: contractOf(call, ctx),
    functionName: call.kind === 'deploy' ? `deploy (constructor)` : fn,
    args: call.args.map((a) => argLine(a, ctx)),
    maxFee: call.fee ? `${formatUnits(call.fee)} XLM` : null,
    signers: signersOf(call),
    loss: lossOf(call, ctx),
    showEnforced,
    showFundsLabel: fn === 'allow_fund',
    planned,
  };
}
