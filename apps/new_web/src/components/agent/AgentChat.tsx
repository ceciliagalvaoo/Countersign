import React, { useEffect, useRef, useState } from 'react';
import type { ToolCallLog, TranscriptEntry } from '../../types/countersign';
import { LABEL_UNTRUSTED } from '../../constants/labels';
import SafeMarkdown from './SafeMarkdown';

/**
 * Chat with apps/agent. Every message is rendered as plain text (React escapes it; never HTML).
 * While a turn is running, the tool calls the service has already logged are listed by name.
 */

interface Props {
  transcript: TranscriptEntry[];
  sending: boolean;
  pendingMessage: string | null;
  liveToolCalls: ToolCallLog[];
  turns: number;
  error: string | null;
  onSend: (message: string) => void;
  onNewConversation: () => void;
}

/** True when the tool result the LLM received had fields marked as untrusted by the agent service */
export function hasUntrusted(output: unknown): boolean {
  try {
    return /untrusted/i.test(JSON.stringify(output) ?? '');
  } catch {
    return false;
  }
}

const ToolCallLine: React.FC<{ call: ToolCallLog }> = ({ call }) => (
  <li className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-gray-400">
    <span className="font-mono text-gray-100">{call.tool}</span>
    <span>{call.isError ? 'failed, nothing assumed' : `${call.durationMs} ms`}</span>
    {hasUntrusted(call.output) && <span className="italic">fund text: {LABEL_UNTRUSTED}</span>}
  </li>
);

const AgentChat: React.FC<Props> = ({ transcript, sending, pendingMessage, liveToolCalls, turns, error, onSend, onNewConversation }) => {
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [transcript.length, pendingMessage, liveToolCalls.length]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const m = text.trim();
    if (!m || sending) return;
    onSend(m);
    setText('');
  };

  return (
    <section className="flex h-full min-h-[32rem] flex-col rounded-2xl border border-white/[0.12] bg-white/[0.04] backdrop-blur-xl shadow-[0_18px_60px_rgba(0,0,0,0.45)] text-gray-100 " aria-label="Chat">
      <header className="flex items-baseline justify-between border-b border-white/20 px-4 py-3">
        <h3 className="text-base font-semibold !text-white">Conversation</h3>
        <div className="flex items-baseline gap-3 text-xs text-gray-400">
          <span>
            Turns: <span className="font-mono tabular-nums text-gray-100">{turns}</span>
          </span>
          <button onClick={onNewConversation} disabled={sending} className="underline underline-offset-2 disabled:opacity-50">
            New conversation
          </button>
        </div>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
        {transcript.length === 0 && !pendingMessage && (
          <p className="text-gray-400">
            Describe what you want in one sentence. The agent asks only for what is missing and fills the mandate next to this chat.
            Nothing is valid until you approve it and sign.
          </p>
        )}
        {transcript.map((t, i) => (
          <div key={`${t.turn}-${t.role}-${i}`} className={t.role === 'investor' ? 'ml-8' : 'mr-8'}>
            <p className="text-[11px] text-gray-400">{t.role === 'investor' ? 'You' : 'Agent'}</p>
            {t.role === 'investor' ? (
              <p className="whitespace-pre-wrap rounded-lg bg-primary-700 px-3 py-2 text-white">{t.text}</p>
            ) : (
              <div className="rounded border border-white/15 bg-white/[0.06] px-3 py-2">
                <SafeMarkdown text={t.text} />
              </div>
            )}
          </div>
        ))}
        {pendingMessage && (
          <div className="ml-8">
            <p className="text-[11px] text-gray-400">You</p>
            <p className="whitespace-pre-wrap rounded-lg bg-primary-700 px-3 py-2 text-white">{pendingMessage}</p>
          </div>
        )}
        {sending && (
          <div className="mr-8 rounded border border-dashed border-white/[0.12] px-3 py-2">
            <p className="text-xs text-gray-100">Agent is working{liveToolCalls.length ? ', tool calls so far:' : '...'}</p>
            {liveToolCalls.length > 0 && <ul className="mt-1 space-y-0.5">{liveToolCalls.map((c) => <ToolCallLine key={c.id} call={c} />)}</ul>}
          </div>
        )}
        {error && (
          <p className="text-xs text-gray-100" role="alert">
            {error}
          </p>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={submit} className="border-t border-white/20 p-3">
        <div className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="I keep USDC and want to put 1,000 into receivables funds..."
            className="flex-1 rounded border border-white/[0.12] bg-white/5 px-3 py-2 text-sm text-gray-100 placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-primary"
            maxLength={4000}
            disabled={sending}
          />
          <button type="submit" disabled={sending || !text.trim()} className="rounded bg-primary-700 hover:bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
            Send
          </button>
        </div>
      </form>
    </section>
  );
};

export default AgentChat;
