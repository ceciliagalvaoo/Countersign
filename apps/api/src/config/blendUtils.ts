import { PoolContractV2, PoolV2, RequestType, Request } from '@blend-capital/blend-sdk';
import * as StellarSdk from '@stellar/stellar-sdk';
import { blendConfig, HORIZON_URL, rpcServerOptions } from '../config/blend.js';

const { Horizon, TransactionBuilder, BASE_FEE, xdr, rpc } = StellarSdk;

/**
 * Build a transaction to deposit assets into a Blend pool
 * @param poolAddress - Address of the Blend pool contract
 * @param userAddress - Address of the user depositing
 * @param assetAddress - Address of the asset to deposit
 * @param amount - Amount to deposit (in stroops for XLM, smallest unit for tokens)
 * @returns Transaction XDR ready to be signed
 */
export async function buildDepositTransaction(
  poolAddress: string,
  userAddress: string,
  assetAddress: string,
  amount: bigint
): Promise<string> {
  try {
    const server = new Horizon.Server(HORIZON_URL);
    const sorobanServer = new rpc.Server(blendConfig.rpc, rpcServerOptions);
    
    // Load the user's account to get sequence number
    const account = await server.loadAccount(userAddress);
    
    // Create the pool contract instance (V2)
    const poolContract = new PoolContractV2(poolAddress);
    
    // Create a supply collateral request
    const requests: Request[] = [
      {
        request_type: RequestType.SupplyCollateral,
        address: assetAddress,
        amount: amount,
      },
    ];

    // Build the submit operation using Blend SDK
    const submitOpXdr = poolContract.submit({
      from: userAddress,
      spender: userAddress,
      to: userAddress,
      requests: requests,
    });

    // Parse the operation from XDR (as shown in Blend SDK docs)
    const operation = xdr.Operation.fromXDR(submitOpXdr, 'base64');

    // Build a complete transaction
    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: blendConfig.passphrase,
    })
      .addOperation(operation)
      .setTimeout(300) // 5 minutes
      .build();

    // Simulate the transaction to get proper resource limits
    const simulationResponse = await sorobanServer.simulateTransaction(transaction);
    
    if (rpc.Api.isSimulationError(simulationResponse)) {
      throw new Error(`Simulation failed: ${simulationResponse.error}`);
    }

    // Prepare the transaction with simulation results
    const preparedTransaction = rpc.assembleTransaction(
      transaction,
      simulationResponse
    ).build();

    return preparedTransaction.toXDR();
  } catch (error) {
    console.error('Error building deposit transaction:', error);
    throw new Error('Failed to build deposit transaction');
  }
}

/**
 * Build a transaction to withdraw assets from a Blend pool
 * @param poolAddress - Address of the Blend pool contract
 * @param userAddress - Address of the user withdrawing
 * @param assetAddress - Address of the asset to withdraw
 * @param amount - Amount to withdraw (in stroops for XLM, smallest unit for tokens)
 * @returns Transaction XDR ready to be signed
 */
export async function buildWithdrawTransaction(
  poolAddress: string,
  userAddress: string,
  assetAddress: string,
  amount: bigint
): Promise<string> {
  try {
    const server = new Horizon.Server(HORIZON_URL);
    const sorobanServer = new rpc.Server(blendConfig.rpc, rpcServerOptions);
    
    // Load the user's account to get sequence number
    const account = await server.loadAccount(userAddress);
    
    // Create the pool contract instance (V2)
    const poolContract = new PoolContractV2(poolAddress);
    
    // Create a withdraw collateral request
    const requests: Request[] = [
      {
        request_type: RequestType.WithdrawCollateral,
        address: assetAddress,
        amount: amount,
      },
    ];

    // Build the submit operation using Blend SDK
    const submitOpXdr = poolContract.submit({
      from: userAddress,
      spender: userAddress,
      to: userAddress,
      requests: requests,
    });

    // Parse the operation from XDR (as shown in Blend SDK docs)
    const operation = xdr.Operation.fromXDR(submitOpXdr, 'base64');

    // Build a complete transaction
    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: blendConfig.passphrase,
    })
      .addOperation(operation)
      .setTimeout(300) // 5 minutes
      .build();

    // Simulate the transaction to get proper resource limits
    const simulationResponse = await sorobanServer.simulateTransaction(transaction);
    
    if (rpc.Api.isSimulationError(simulationResponse)) {
      throw new Error(`Simulation failed: ${simulationResponse.error}`);
    }

    // Prepare the transaction with simulation results
    const preparedTransaction = rpc.assembleTransaction(
      transaction,
      simulationResponse
    ).build();

    return preparedTransaction.toXDR();
  } catch (error) {
    console.error('Error building withdraw transaction:', error);
    throw new Error('Failed to build withdraw transaction');
  }
}

/**
 * Reads a user's position in a Blend pool directly from the chain.
 * @returns balance - supplied amount (collateral + plain supply) in the asset's standard units, interest included
 * @returns apy - the reserve's current estimated supply APY, in percent
 */
export async function getOnChainPosition(
  poolAddress: string,
  assetAddress: string,
  userAddress: string
): Promise<{ balance: number; apy: number }> {
  const pool = await PoolV2.load(blendConfig, poolAddress);
  const reserve = pool.reserves.get(assetAddress);
  if (!reserve) {
    throw new Error(`Asset ${assetAddress} is not a reserve of pool ${poolAddress}`);
  }
  const user = await pool.loadUser(userAddress);
  return {
    balance: user.getCollateralFloat(reserve) + user.getSupplyFloat(reserve),
    apy: reserve.estSupplyApy * 100,
  };
}

/**
 * Convert amount to smallest unit (stroops for XLM, similar for tokens)
 * @param amount - Amount in standard units
 * @param decimals - Number of decimals (7 for XLM, varies for tokens)
 * @returns Amount in smallest unit
 */
export function toSmallestUnit(amount: number, decimals: number = 7): bigint {
  return BigInt(Math.floor(amount * Math.pow(10, decimals)));
}

/**
 * Convert amount from smallest unit to standard units
 * @param amount - Amount in smallest unit
 * @param decimals - Number of decimals
 * @returns Amount in standard units
 */
export function fromSmallestUnit(amount: bigint, decimals: number = 7): number {
  return Number(amount) / Math.pow(10, decimals);
}
