// Semantic comparison between the transaction the script built and the one a wallet tool signed.
// Used when the signed hash differs from the built one (e.g. Stellar Lab re-simulates before signing and the
// resources change). Accepted only when everything that decides WHAT is executed is byte for byte identical:
// source, sequence, operation, host function and arguments, authorization entries, memo and preconditions; the
// time bounds may only be narrower and the fees may only be lower. Resources (footprint, instructions, bytes) may
// differ, because they only bound execution cost: the network still runs exactly the same call.

export interface FieldCheck {
  field: string;
  ok: boolean;
  built: string;
  signed: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTx = any;

function sorobanData(tx: AnyTx) {
  const ext = tx.toEnvelope().v1().tx().ext();
  return ext.switch() === 1 ? ext.sorobanData() : null;
}

function resourcesSummary(d: AnyTx): string {
  if (!d) return 'none';
  const r = d.resources();
  const fp = r.footprint();
  return `instructions ${r.instructions()}, disk read ${r.diskReadBytes?.() ?? r.readBytes?.()}, write ${r.writeBytes()}, footprint ro ${fp.readOnly().length} rw ${fp.readWrite().length}`;
}

export function compareSigned(built: AnyTx, signed: AnyTx): { equal: boolean; checks: FieldCheck[] } {
  const checks: FieldCheck[] = [];
  const eq = (field: string, a: string, b: string) => checks.push({ field, ok: a === b, built: a, signed: b });
  const b64 = (x: AnyTx) => (x ? x.toXDR('base64') : 'none');

  eq('source', built.source, signed.source);
  eq('sequence', built.sequence, signed.sequence);
  eq('operation count', String(built.operations.length), String(signed.operations.length));
  const bo = built.operations[0];
  const so = signed.operations[0];
  eq('operation type', bo?.type ?? 'none', so?.type ?? 'none');
  eq('operation source', bo?.source ?? 'tx source', so?.source ?? 'tx source');
  eq('host function and arguments (XDR bytes)', b64(bo?.func), b64(so?.func));
  const ba = (bo?.auth ?? []).map(b64);
  const sa = (so?.auth ?? []).map(b64);
  eq('authorization entries (count)', String(ba.length), String(sa.length));
  ba.forEach((x: string, i: number) => eq(`authorization entry ${i} (credentials and invocations)`, x, sa[i] ?? 'missing'));
  eq('memo', JSON.stringify({ t: built.memo.type, v: String(built.memo.value ?? '') }), JSON.stringify({ t: signed.memo.type, v: String(signed.memo.value ?? '') }));
  eq(
    'other preconditions',
    JSON.stringify([built.ledgerBounds ?? null, built.minAccountSequence ?? null, built.minAccountSequenceAge ?? null, built.minAccountSequenceLedgerGap ?? null, built.extraSigners ?? []]),
    JSON.stringify([signed.ledgerBounds ?? null, signed.minAccountSequence ?? null, signed.minAccountSequenceAge ?? null, signed.minAccountSequenceLedgerGap ?? null, signed.extraSigners ?? []])
  );

  // Time bounds: the signed window must lie inside the built one
  const bMin = BigInt(built.timeBounds?.minTime ?? 0);
  const bMax = BigInt(built.timeBounds?.maxTime ?? 0);
  const sMin = BigInt(signed.timeBounds?.minTime ?? 0);
  const sMax = BigInt(signed.timeBounds?.maxTime ?? 0);
  const inside = sMin >= bMin && (bMax === 0n ? true : sMax !== 0n && sMax <= bMax);
  checks.push({ field: 'time bounds within the built ones', ok: inside, built: `${bMin}..${bMax}`, signed: `${sMin}..${sMax}` });

  // Fees may only be lower
  checks.push({ field: 'total fee not higher', ok: BigInt(signed.fee) <= BigInt(built.fee), built: built.fee, signed: signed.fee });
  const bd = sorobanData(built);
  const sd = sorobanData(signed);
  checks.push({ field: 'soroban data present', ok: !!bd === !!sd, built: bd ? 'yes' : 'no', signed: sd ? 'yes' : 'no' });
  if (bd && sd) {
    const bi = BigInt(built.fee) - BigInt(bd.resourceFee().toString());
    const si = BigInt(signed.fee) - BigInt(sd.resourceFee().toString());
    checks.push({ field: 'inclusion fee not higher', ok: si <= bi, built: bi.toString(), signed: si.toString() });
    checks.push({ field: 'resource fee not higher', ok: BigInt(sd.resourceFee().toString()) <= BigInt(bd.resourceFee().toString()), built: bd.resourceFee().toString(), signed: sd.resourceFee().toString() });
    const same = b64(bd.resources()) === b64(sd.resources());
    checks.push({ field: 'resources (informative, may differ)', ok: true, built: resourcesSummary(bd), signed: same ? 'same' : resourcesSummary(sd) });
  }
  return { equal: checks.every((c) => c.ok), checks };
}

export function formatChecks(checks: FieldCheck[]): string {
  return checks
    .map((c) => {
      const same = c.built === c.signed || c.signed === 'same';
      const shown = (v: string) => (v.length > 90 ? `${v.slice(0, 40)}...${v.slice(-40)}` : v);
      return `  [${c.ok ? 'ok' : 'DIFFERS'}] ${c.field}${same ? '' : `: built ${shown(c.built)} | signed ${shown(c.signed)}`}`;
    })
    .join('\n');
}
