// All amounts are stroops. These are operator policy limits, not network minima.
export const FEE_LIMITS = Object.freeze({
  inclusionFloor: 1_000n,
  inclusionMax: 100_000n,
  resourceMargin: 1_000n,
  resourceMax: 10_000_000n,
  totalMax: 10_100_000n,
});

export function stroops(value: unknown, label: string): bigint {
  const s = String(value);
  if (!/^(0|[1-9]\d*)$/.test(s)) throw new Error(`invalid ${label}: expected unsigned integer stroops`);
  return BigInt(s);
}

export function inclusionBid(p90: unknown, configured = '1000'): bigint {
  const floor = stroops(configured, 'MAINNET_INCLUSION_FEE_STROOPS');
  const recent = stroops(p90, 'Soroban inclusion p90');
  // p90 is a historical hint, never a mandatory protocol minimum or a guarantee.
  const bid = [FEE_LIMITS.inclusionFloor, floor, recent].reduce((a, b) => a > b ? a : b);
  if (bid > FEE_LIMITS.inclusionMax) throw new Error('inclusion bid exceeds 100000 stroops: stop and review fees');
  return bid;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function feeParts(tx: any) {
  const ext = tx.toEnvelope().v1().tx().ext();
  if (ext.switch() !== 1) throw new Error('missing Soroban transaction data');
  const total = stroops(tx.fee, 'total fee');
  const resource = stroops(ext.sorobanData().resourceFee().toString(), 'resource fee');
  return { total, resource, inclusion: total - resource };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function checkFeeLimits(tx: any, expectedInclusion?: bigint) {
  const fees = feeParts(tx);
  if (fees.inclusion < FEE_LIMITS.inclusionFloor || fees.inclusion > FEE_LIMITS.inclusionMax)
    throw new Error('inclusion fee outside policy (1000..100000 stroops): rebuild and sign again');
  if (fees.resource > FEE_LIMITS.resourceMax || fees.total > FEE_LIMITS.totalMax)
    throw new Error('resource/total fee exceeds policy (10000000/10100000 stroops): stop and review fees');
  if (expectedInclusion !== undefined && fees.inclusion !== expectedInclusion)
    throw new Error('SDK prepared an unexpected inclusion fee: not accepted');
  return fees;
}

// Apply only during prepare(), before signing. The margin must fit inside the
// existing caps; never clamp an over-budget estimate to make it pass.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withResourceFeeMargin(Sdk: any, prepared: any, expectedInclusion: bigint) {
  if (prepared.signatures.length) throw new Error('resource fee margin must be applied before signing');
  const fees = checkFeeLimits(prepared, expectedInclusion);
  const data = new Sdk.SorobanDataBuilder(prepared.toEnvelope().v1().tx().ext().sorobanData().toXDR());
  data.setResourceFee((fees.resource + FEE_LIMITS.resourceMargin).toString());
  // cloneFrom's fee option is inclusion per operation; build adds resourceFee.
  const padded = Sdk.TransactionBuilder.cloneFrom(prepared, {
    fee: fees.inclusion.toString(), sorobanData: data.build(),
  }).build();
  const result = checkFeeLimits(padded, expectedInclusion);
  if (result.resource !== fees.resource + FEE_LIMITS.resourceMargin ||
      result.total !== fees.total + FEE_LIMITS.resourceMargin)
    throw new Error('SDK prepared an unexpected resource/total fee margin: not accepted');
  return padded;
}

// Read-only simulation of the exact envelope; never assemble or modify a signed XDR.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function checkSimulatedFee(tx: any, sim: any) {
  const fees = checkFeeLimits(tx);
  if ('error' in sim) throw new Error(`fee preflight simulation failed: ${sim.error}`);
  if (!sim.transactionData || sim.restorePreamble) throw new Error('fee preflight requires a successful simulation without restoration');
  const minimum = stroops(sim.minResourceFee, 'simulated minimum resource fee');
  if (fees.resource < minimum)
    throw new Error(`resource fee ${fees.resource} below current simulated minimum ${minimum}: rebuild and sign again`);
  return fees;
}
