import React, { useEffect, useState } from 'react';
import { useWallet } from '../contexts/WalletContext';
import { useSignedCall } from '../hooks/useSignedCall';
import { fundPauseService } from '../services/countersign';
import ApprovalCard from './ApprovalCard';
import TxStatus from './TxStatus';
import type { CardContext } from './approvalCardModel';

/**
 * Issuer kill switch (S14): set_pause(true|false) on the fund's FundToken, signed by the fund wallet.
 * Same loop as useOrderApproval (the API builds, the fund wallet signs, the API verifies), with the
 * approval card in front of the wallet.
 */

interface Props {
  fund: { id: string; name: string; symbol: string; paused?: boolean | null };
  onDone: () => void;
}

const PauseFundUnits: React.FC<Props> = ({ fund, onDone }) => {
  const { publicKey, connect } = useWallet();
  const flow = useSignedCall();
  // Initial state from GET /funds (paused read from the FundToken); then from each verified confirm
  const [paused, setPaused] = useState<boolean>(!!fund.paused);
  useEffect(() => {
    if (typeof fund.paused === 'boolean') setPaused(fund.paused);
  }, [fund.paused]);
  const [open, setOpen] = useState(false);
  const target = !paused;

  const start = () => {
    setOpen(true);
    void flow.prepare({
      build: () => fundPauseService.build(fund.id, target),
      confirm: async (h) => {
        const r = await fundPauseService.confirm(fund.id, h, target);
        setPaused(typeof r.paused === 'boolean' ? r.paused : target);
        onDone();
        return r;
      },
    });
  };

  const close = () => {
    flow.reset();
    setOpen(false);
  };

  const ctx: CardContext = { userPublicKey: publicKey, walletContractId: null, funds: [], audience: 'issuer' };

  return (
    <>
      <button
        onClick={start}
        className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
          paused ? 'border-white/40 text-white hover:bg-white/10' : 'border-[#9E2A2B] text-white bg-[#9E2A2B] hover:bg-[#9E2A2B]/90'
        }`}
      >
        {paused ? 'Resume' : 'Pause fund units'}
      </button>
      {paused && <span className="px-2 py-1 text-xs rounded-md border border-[#9E2A2B] text-white">Units paused</span>}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-[#020617]">
            {flow.prepared ? (
              <ApprovalCard
                prepared={flow.prepared}
                phase={flow.phase}
                ctx={ctx}
                connectedKey={publicKey}
                onSign={flow.sign}
                onCancel={close}
                onRetryConfirm={flow.retryConfirm}
                onConnect={connect}
              />
            ) : (
              <div className="rounded-md bg-white/[0.04] p-4 text-sm text-gray-100 ">
                {flow.phase.kind === 'preparing' && <p>Building and decoding the transaction...</p>}
                {flow.phase.kind === 'failed' && <TxStatus view={{ state: 'failed', message: flow.phase.message }} />}
                {flow.phase.kind === 'refused_contract' && (
                  <TxStatus view={{ state: 'refused_contract', code: flow.phase.code, name: flow.phase.name, detail: flow.phase.detail }} />
                )}
                {flow.phase.kind !== 'preparing' && (
                  <button onClick={close} className="mt-2 text-xs text-gray-400 underline underline-offset-2">
                    Close
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default PauseFundUnits;
