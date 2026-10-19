import crypto from 'crypto';
import * as Sdk from '@stellar/stellar-sdk';
import { blendConfig, rpcServerOptions } from '../config/blend.js';

// Builds (and simulates) Soroban transactions for the user's wallet to sign, reads contract state,
// and decodes confirmed transactions so the API can verify exactly what was executed on-chain.

const server = new Sdk.rpc.Server(blendConfig.rpc, rpcServerOptions);
const PASSPHRASE = blendConfig.passphrase;

/** RPC client and passphrase shared with the services that submit transactions (mandate wallet, agent) */
export const rpcServer = server;
export const NETWORK_PASSPHRASE = PASSPHRASE;
/** The network is never inside a transaction envelope: it travels next to it, out of band */
export const NETWORK_LABEL = PASSPHRASE === Sdk.Networks.PUBLIC ? 'Stellar mainnet' : 'Stellar testnet';
export const EXPLORER_TX_BASE =
  PASSPHRASE === Sdk.Networks.PUBLIC ? 'https://stellar.expert/explorer/public/tx/' : 'https://stellar.expert/explorer/testnet/tx/';

/** Stellar Asset Contract (SAC) address of a classic asset on this network */
export function assetContractId(asset: { code: string; issuer: string }): string {
  return new Sdk.Asset(asset.code, asset.issuer).contractId(PASSPHRASE);
}

export const SHARE_DECIMALS = 7;

export const toAddressVal = (address: string) => Sdk.nativeToScVal(address, { type: 'address' });
export const toI128Val = (value: bigint) => Sdk.nativeToScVal(value, { type: 'i128' });
export const toStringVal = (value: string) => Sdk.nativeToScVal(value, { type: 'string' });
export const toSymbolVal = (value: string) => Sdk.nativeToScVal(value, { type: 'symbol' });

/** Converts a share quantity (e.g. 33.3333333) to the token's integer units */
export function toShareUnits(quantity: number): bigint {
  return BigInt(Math.round(quantity * 10 ** SHARE_DECIMALS));
}

/** RPC can lag a few ledgers behind Horizon: a just-created account may not be visible yet, so retry briefly */
async function loadAccount(source: string): Promise<Sdk.Account> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await server.getAccount(source);
    } catch (error) {
      if (attempt >= 6 || !/not found/i.test((error as Error).message)) throw error;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

async function prepare(source: string, operation: Sdk.xdr.Operation, timeoutSeconds = 300): Promise<string> {
  const account = await loadAccount(source);
  const tx = new Sdk.TransactionBuilder(account, { fee: Sdk.BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(operation)
    .setTimeout(timeoutSeconds)
    .build();
  // Simulates the call (throws if it would fail) and attaches footprint, resources and auth
  const prepared = await server.prepareTransaction(tx);
  return prepared.toXDR();
}

/** Unsigned, simulated transaction invoking `method` on `contractId`, to be signed by `source` */
export function prepareInvocation(
  source: string,
  contractId: string,
  method: string,
  args: Sdk.xdr.ScVal[],
  timeoutSeconds?: number
) {
  return prepare(source, new Sdk.Contract(contractId).call(method, ...args), timeoutSeconds);
}

/** Unsigned, simulated transaction deploying a contract from an uploaded Wasm hash, running its constructor */
export function prepareDeploy(source: string, wasmHashHex: string, constructorArgs: Sdk.xdr.ScVal[]) {
  return prepare(
    source,
    Sdk.Operation.createCustomContract({
      address: Sdk.Address.fromString(source),
      wasmHash: Buffer.from(wasmHashHex, 'hex'),
      constructorArgs,
      salt: crypto.randomBytes(32),
    })
  );
}

/** Read-only contract call through simulation (nothing is signed or submitted) */
export async function readContract<T = unknown>(contractId: string, method: string, args: Sdk.xdr.ScVal[] = []): Promise<T> {
  // Any syntactically valid account works as the source of a simulation
  const source = new Sdk.Account(Sdk.Keypair.random().publicKey(), '0');
  const tx = new Sdk.TransactionBuilder(source, { fee: Sdk.BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(new Sdk.Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (Sdk.rpc.Api.isSimulationError(sim) || !sim.result) {
    throw new Error(`Contract read ${method} failed: ${(sim as any).error ?? 'no result'}`);
  }
  return Sdk.scValToNative(sim.result.retval) as T;
}

export interface ConfirmedCall {
  source: string;
  kind: 'invoke' | 'deploy';
  contractId?: string; // invoke: called contract; deploy: created contract
  method?: string;
  args?: unknown[]; // invoke: call arguments; deploy: constructor arguments (empty for a create without constructor)
  wasmHash?: string;
}

/** Fetches a submitted transaction from RPC (waiting briefly for ingestion) and decodes its single host function */
export async function getConfirmedCall(hash: string): Promise<ConfirmedCall> {
  if (!/^[0-9a-f]{64}$/i.test(hash)) throw new Error('Invalid transaction hash');

  let res = await server.getTransaction(hash);
  for (let i = 0; i < 10 && res.status === Sdk.rpc.Api.GetTransactionStatus.NOT_FOUND; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    res = await server.getTransaction(hash);
  }
  if (res.status !== Sdk.rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(res.status === 'NOT_FOUND' ? 'Transaction not found on the network' : 'Transaction failed on-chain');
  }

  const tx = new Sdk.Transaction(res.envelopeXdr, PASSPHRASE);
  if (tx.operations.length !== 1 || tx.operations[0].type !== 'invokeHostFunction') {
    throw new Error('Not a single contract call');
  }
  const fn = (tx.operations[0] as Sdk.Operation.InvokeHostFunction).func;

  switch (fn.switch().name) {
    case 'hostFunctionTypeInvokeContract': {
      const call = fn.invokeContract();
      return {
        source: tx.source,
        kind: 'invoke',
        contractId: Sdk.Address.fromScAddress(call.contractAddress()).toString(),
        method: call.functionName().toString(),
        args: call.args().map((a) => Sdk.scValToNative(a)),
      };
    }
    case 'hostFunctionTypeCreateContractV2':
    case 'hostFunctionTypeCreateContract': {
      const create = fn.switch().name === 'hostFunctionTypeCreateContractV2' ? fn.createContractV2() : fn.createContract();
      const executable = create.executable();
      return {
        source: tx.source,
        kind: 'deploy',
        contractId: res.returnValue ? String(Sdk.scValToNative(res.returnValue)) : undefined,
        args:
          fn.switch().name === 'hostFunctionTypeCreateContractV2'
            ? fn.createContractV2().constructorArgs().map((a) => Sdk.scValToNative(a))
            : [],
        wasmHash: executable.switch().name === 'contractExecutableWasm' ? executable.wasmHash().toString('hex') : undefined,
      };
    }
    default:
      throw new Error('Unsupported host function');
  }
}
