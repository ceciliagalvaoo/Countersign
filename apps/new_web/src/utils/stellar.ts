import * as StellarSdk from '@stellar/stellar-sdk';

const STELLAR_NETWORK = StellarSdk.Networks.TESTNET;
const HORIZON_URL = 'https://horizon-testnet.stellar.org';

export const stellarConfig = {
  network: STELLAR_NETWORK,
  horizonUrl: HORIZON_URL,
  baseFee: StellarSdk.BASE_FEE,
  timeout: 180,
};

/**
 * Creates a Stellar server instance
 */
export const createServer = () => new StellarSdk.Horizon.Server(stellarConfig.horizonUrl);

/**
 * Builds a payment transaction
 */
export interface PaymentTransactionParams {
  sourcePublicKey: string;
  destination: string;
  amount: string;
  memo: string;
  asset?: StellarSdk.Asset;
}

export const buildPaymentTransaction = async (
  params: PaymentTransactionParams
): Promise<StellarSdk.Transaction> => {
  const server = createServer();
  const account = await server.loadAccount(params.sourcePublicKey);

  return new StellarSdk.TransactionBuilder(account, {
    fee: stellarConfig.baseFee,
    networkPassphrase: stellarConfig.network,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: params.destination,
        asset: params.asset || StellarSdk.Asset.native(),
        amount: params.amount,
      })
    )
    .addMemo(StellarSdk.Memo.text(params.memo))
    .setTimeout(stellarConfig.timeout)
    .build();
};

/**
 * Gets transaction explorer URL
 */
export const getTransactionUrl = (txHash: string): string => {
  return `https://stellar.expert/explorer/testnet/tx/${txHash}`;
};

/**
 * Truncates memo to Stellar's 28-byte limit
 */
export const truncateMemo = (memo: string, maxLength: number = 28): string => {
  return memo.substring(0, maxLength);
};
