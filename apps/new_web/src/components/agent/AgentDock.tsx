import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/useAuth';
import { agentClient } from '../../services/agentClient';
import { currentSessionId, newSessionId, sessionKey } from '../../services/agentSession';
import type { AgentSessionView } from '../../types/countersign';
import { errorText } from '../../utils/contractErrors';
import { Orb } from '../ink/Orb';
import AgentChat from './AgentChat';

/**
 * The agent, available from every investor screen: an orb in the corner opens the same conversation as the
 * agent page, in a side panel. It answers and proposes; nothing is signed here. Every signature happens on the
 * agent page, on a card decoded from the transaction, so the dock links there whenever a signature is waiting.
 * Investors only: the agent has no manager tools, by design. Hidden on the agent page, where the chat is open.
 */
const AgentDock: React.FC = () => {
  const { user } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<AgentSessionView | null>(null);
  const [sending, setSending] = useState(false);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hidden = !user || user.role !== 'INVESTIDOR' || location.pathname.startsWith('/agent');

  const refresh = useCallback(async (id: string) => {
    try {
      setSession(await agentClient.session(id));
    } catch (e) {
      setError(`Agent service: ${errorText(e)}`);
    }
  }, []);

  // Pick up the same conversation as the agent page each time the dock opens
  useEffect(() => {
    if (!open || !user) return;
    const id = currentSessionId(user.id);
    setSessionId(id);
    void refresh(id);
  }, [open, user, refresh]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (hidden) return null;

  const send = async (message: string) => {
    if (!sessionId) return;
    setSending(true);
    setPendingMessage(message);
    setError(null);
    try {
      setSession(await agentClient.chat(sessionId, message));
    } catch (e) {
      setError(`The agent did not answer: ${errorText(e)}. Nothing was proposed or bought.`);
      void refresh(sessionId);
    } finally {
      setPendingMessage(null);
      setSending(false);
    }
  };

  const newConversation = () => {
    if (!user) return;
    const id = newSessionId();
    try {
      localStorage.setItem(sessionKey(user.id), id);
    } catch {
      /* the conversation still works for this visit */
    }
    setSessionId(id);
    setSession(null);
  };

  const signatureWaiting = session?.pendingAction?.kind === 'needs_investor_signature';

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-3 rounded-full border border-navy/10 bg-cream py-2 pl-2 pr-5 shadow-ink-lg transition-transform hover:-translate-y-0.5"
          aria-label="Ask the agent"
        >
          <Orb size={44} state={sending ? 'thinking' : 'idle'} decorative />
          <span className="text-14 font-medium text-navy">Ask the agent</span>
        </button>
      )}
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-label="The agent">
          <button className="module-scrim absolute inset-0 bg-navy/20" aria-label="Close the agent" onClick={() => setOpen(false)} />
          <div className="module-panel relative flex h-full w-full max-w-[460px] flex-col gap-3 bg-cream p-4 shadow-ink-lg">
            <div className="flex items-center justify-between">
              <p className="eyebrow">Same conversation as the agent page</p>
              <button onClick={() => setOpen(false)} className="btn btn-sm btn-ghost">
                Close
              </button>
            </div>
            {signatureWaiting && (
              <div className="rounded-well border border-ochre/50 bg-ochre/5 px-3 py-2 text-12 text-navy" role="status">
                <span className="font-medium text-ochre">Awaiting your signature.</span> Signatures happen on the agent page, on a card decoded from the transaction.{' '}
                <Link to="/agent" onClick={() => setOpen(false)} className="text-cobalt underline-offset-4 hover:underline">
                  Open the agent page
                </Link>
              </div>
            )}
            <div className="min-h-0 flex-1">
              <AgentChat
                transcript={session?.transcript ?? []}
                sending={sending}
                pendingMessage={pendingMessage}
                liveToolCalls={sending && session ? session.lastToolCalls.filter((c) => c.turn > (session?.turns ?? 0)) : []}
                turns={session?.turns ?? 0}
                error={error}
                onSend={send}
                onNewConversation={newConversation}
              />
            </div>
            <p className="text-11 text-ink-soft">
              The agent proposes; it cannot sign or change your limits. Plan, mandate and signatures are on the{' '}
              <Link to="/agent" onClick={() => setOpen(false)} className="text-cobalt underline-offset-4 hover:underline">
                agent page
              </Link>
              .
            </p>
          </div>
        </div>
      )}
    </>
  );
};

export default AgentDock;
