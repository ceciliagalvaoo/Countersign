// Contract IDs and admin address come from your own testnet deployment (see contracts/README.md)
export const STELLAR_CONFIG = {
  NETWORK: 'testnet',
  HORIZON_URL: 'https://horizon-testnet.stellar.org',
  CONTRACTS: {
    FUND_TOKEN: process.env.FUND_TOKEN_CONTRACT_ID || '',
    RECEIVABLE_VAULT: process.env.RECEIVABLE_VAULT_CONTRACT_ID || ''
  },
  ADMIN_ADDRESS: process.env.STELLAR_ADMIN_ADDRESS || '',
  // Uploaded FundToken Wasm: every approved fund deploys its own share token from it
  FUND_TOKEN_WASM_HASH: process.env.FUND_TOKEN_WASM_HASH || '',
  // ZK investor badges (contracts/badge-verifier); the attester key itself is BADGE_ATTESTER_SECRET
  BADGE_VERIFIER: process.env.BADGE_VERIFIER_CONTRACT_ID || '',
  // Investments, refunds and fund prices are denominated in USDC (1 quota price unit = 1 USDC).
  // Default: the testnet USDC used by the Blend pools, so received funds can be supplied to Blend as-is.
  PAYMENT_ASSET: {
    code: process.env.PAYMENT_ASSET_CODE || 'USDC',
    issuer: process.env.PAYMENT_ASSET_ISSUER || 'GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56',
  },
  // Blend's testnet faucet (trustlines + 1000 test USDC); only used on testnet
  TESTNET_FAUCET_URL: 'https://ewqw4hx7oa.execute-api.us-east-1.amazonaws.com/getAssets',
};
