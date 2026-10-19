import { Network } from '@blend-capital/blend-sdk';

// Soroban RPC endpoint: SOROBAN_RPC_URL overrides the public testnet RPC (e.g. a provider, or an unreachable URL
// in the adversarial suite). http:// is only accepted for local endpoints used by tests.
const SOROBAN_RPC_URL = process.env.SOROBAN_RPC_URL?.trim() || 'https://soroban-testnet.stellar.org';
const RPC_ALLOW_HTTP = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(SOROBAN_RPC_URL);

// Blend Protocol configuration for testnet
export const blendConfig: Network = {
  rpc: SOROBAN_RPC_URL,
  passphrase: 'Test SDF Network ; September 2015',
  maxConcurrentRequests: 5,
  opts: {
    allowHttp: RPC_ALLOW_HTTP,
  },
};

// Horizon API URL for testnet (different from RPC)
export const HORIZON_URL = 'https://horizon-testnet.stellar.org';

// Official Blend Protocol Testnet Contract Addresses (verified 2026-10-17; the testnet is reset periodically)
// Source: https://github.com/blend-capital/blend-utils/blob/main/testnet.contracts.json
//
// Note: "TestnetV2" is likely a pool contract. To find specific pools for different assets:
// 1. Visit https://testnet.blend.capital
// 2. Navigate to Markets to see active pools
// 3. Each pool has its own contract address (click pool for details)

export const BLEND_CONTRACTS = {
  // Testnet V2 Pool - This is a deployed pool contract on testnet
  // You can use this or find other pools at https://testnet.blend.capital
  USDC_POOL: 'CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF',
  
  // Asset addresses from official Blend testnet contracts
  USDC: 'CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU',
  XLM: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
  BLND: 'CB22KRA3YZVCNCQI64JQ5WE7UY2VAV7WFLK6A2JN3HEX56T2EDAFO7QF',
  
  // Other Blend Protocol Contracts (for reference)
  BACKSTOP_V2: 'CBDVWXT433PRVTUNM56C3JREF3HIZHRBA64NB2C3B2UNCKIS65ZYCLZA',
  POOL_FACTORY_V2: 'CDV6RX4CGPCOKGTBFS52V3LMWQGZN3LCQTXF5RVPOOCG4XVMHXQ4NTF6',
};

// Available pools
export interface BlendPoolConfig {
  address: string;
  name: string;
  assetAddress: string;
  assetSymbol: string;
  description: string;
}

export const AVAILABLE_POOLS: BlendPoolConfig[] = [
  {
    address: BLEND_CONTRACTS.USDC_POOL,
    name: 'USDC Lending Pool',
    assetAddress: BLEND_CONTRACTS.USDC,
    assetSymbol: 'USDC',
    description: 'Deposit USDC and earn yield from lending activities',
  },
];

/** Options for every rpc.Server built from blendConfig.rpc (allowHttp only for a local test endpoint) */
export const rpcServerOptions = { allowHttp: RPC_ALLOW_HTTP };
