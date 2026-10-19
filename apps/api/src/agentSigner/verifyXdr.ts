import * as Sdk from '@stellar/stellar-sdk';

/**
 * Pure check that a transaction is exactly subscribe(decision, fund_wallet, amount) on one investor's mandate
 * wallet, with the agent key as source, and nothing else the agent signature could authorize.
 */

export interface ExpectedSubscribe {
  source: string; // the agent public key of this investor
  walletContractId: string; // her mandate wallet (C...)
  decisionHashHex: string; // hash of the APPROVED log row
  fundWallet: string; // Fund.fundWalletPublicKey of the decision's fund
  amountUnits: bigint; // amountUnits of the decision
}

/** Upper bound on the total fee the agent account pays for one subscribe (1 XLM). Soroban fees are far lower */
export const MAX_FEE_STROOPS = 10_000_000n;

export type XdrCheck =
  | { ok: true; tx: Sdk.Transaction }
  | {
      ok: false;
      field: 'envelope' | 'source' | 'operation' | 'contract' | 'method' | 'args' | 'decision' | 'destination' | 'amount' | 'auth' | 'fee';
      reason: string;
    };

const fail = (field: Extract<XdrCheck, { ok: false }>['field'], reason: string): XdrCheck => ({ ok: false, field, reason });

function sameArgs(a: Sdk.xdr.ScVal[], b: Sdk.xdr.ScVal[]) {
  return a.length === b.length && a.every((v, i) => v.toXDR('base64') === b[i].toXDR('base64'));
}

export function checkSubscribeXdr(xdrB64: string, expected: ExpectedSubscribe, networkPassphrase: string): XdrCheck {
  let parsed: Sdk.Transaction | Sdk.FeeBumpTransaction;
  try {
    parsed = Sdk.TransactionBuilder.fromXDR(xdrB64, networkPassphrase);
  } catch {
    return fail('envelope', 'not a transaction envelope');
  }
  if (parsed instanceof Sdk.FeeBumpTransaction) return fail('envelope', 'fee bump envelopes are not signed');
  const tx = parsed;

  if (tx.source !== expected.source) return fail('source', 'transaction source is not this investor agent key');
  if (BigInt(tx.fee) > MAX_FEE_STROOPS) return fail('fee', 'fee above the signer limit');
  if (tx.operations.length !== 1) return fail('operation', 'expected exactly one operation');
  const op = tx.operations[0];
  if (op.type !== 'invokeHostFunction') return fail('operation', 'operation is not invokeHostFunction');
  if (op.source && op.source !== expected.source) return fail('source', 'operation source differs from the agent key');
  const func = (op as Sdk.Operation.InvokeHostFunction).func;
  if (func.switch().name !== 'hostFunctionTypeInvokeContract') return fail('operation', 'host function is not a contract call');

  const call = func.invokeContract();
  if (Sdk.Address.fromScAddress(call.contractAddress()).toString() !== expected.walletContractId) {
    return fail('contract', 'contract is not this investor mandate wallet');
  }
  if (call.functionName().toString() !== 'subscribe') return fail('method', 'method is not subscribe');
  const args = call.args();
  if (args.length !== 3) return fail('args', 'subscribe takes exactly three arguments');

  const [decision, fundWallet, amount] = args;
  if (decision.switch().name !== 'scvBytes' || decision.bytes().length !== 32) return fail('decision', 'decision is not 32 bytes');
  if (decision.bytes().toString('hex') !== expected.decisionHashHex.toLowerCase()) return fail('decision', 'decision differs from the approved log row');
  if (fundWallet.switch().name !== 'scvAddress') return fail('destination', 'fund_wallet is not an address');
  if (Sdk.Address.fromScVal(fundWallet).toString() !== expected.fundWallet) return fail('destination', 'fund_wallet differs from the fund wallet in the database');
  if (amount.switch().name !== 'scvI128') return fail('amount', 'amount is not i128');
  if (BigInt(Sdk.scValToNative(amount) as bigint) !== expected.amountUnits) return fail('amount', 'amount differs from the approved decision');

  // Authorization: only source account credentials whose root is this very call, with no sub invocation.
  // (Address credentials would need a separate signAuthEntry, which the signer never does.)
  const auth = (op as Sdk.Operation.InvokeHostFunction).auth ?? [];
  for (const entry of auth) {
    if (entry.credentials().switch().name !== 'sorobanCredentialsSourceAccount') return fail('auth', 'unexpected address credentials');
    const root = entry.rootInvocation();
    const fn = root.function();
    if (fn.switch().name !== 'sorobanAuthorizedFunctionTypeContractFn') return fail('auth', 'authorized function is not a contract call');
    const c = fn.contractFn();
    if (
      Sdk.Address.fromScAddress(c.contractAddress()).toString() !== expected.walletContractId ||
      c.functionName().toString() !== 'subscribe' ||
      !sameArgs(c.args(), args) ||
      root.subInvocations().length !== 0
    ) {
      return fail('auth', 'authorization entry does not match the subscribe call');
    }
  }
  return { ok: true, tx };
}
