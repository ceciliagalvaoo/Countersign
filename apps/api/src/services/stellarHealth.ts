import type { FastifyBaseLogger } from 'fastify';
import { rpc } from '@stellar/stellar-sdk';
import { STELLAR_CONFIG } from '../config/stellar.js';
import { blendConfig, BLEND_CONTRACTS, rpcServerOptions } from '../config/blend.js';

const server = new rpc.Server(blendConfig.rpc, rpcServerOptions);

/**
 * Warns at startup when a configured contract no longer exists on the network.
 * Testnet is reset periodically; after a reset, run contracts/scripts/deploy-testnet.sh.
 */
export async function checkConfiguredContracts(log: FastifyBaseLogger) {
  const contracts: Record<string, string> = {
    FUND_TOKEN_CONTRACT_ID: STELLAR_CONFIG.CONTRACTS.FUND_TOKEN,
    RECEIVABLE_VAULT_CONTRACT_ID: STELLAR_CONFIG.CONTRACTS.RECEIVABLE_VAULT,
    'Blend USDC pool': BLEND_CONTRACTS.USDC_POOL,
  };

  for (const [name, id] of Object.entries(contracts)) {
    if (!id) {
      log.warn(`${name} is not configured`);
      continue;
    }
    try {
      await server.getContractWasmByContractId(id);
    } catch {
      log.warn(
        `${name} (${id}) was not found on ${STELLAR_CONFIG.NETWORK}. ` +
          'If the testnet was reset, redeploy with contracts/scripts/deploy-testnet.sh and update the environment.'
      );
    }
  }
}
