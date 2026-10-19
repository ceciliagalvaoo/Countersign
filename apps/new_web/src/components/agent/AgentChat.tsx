import React, { useEffect, useRef, useState } from 'react';
import type { ToolCallLog, TranscriptEntry } from '../../types/countersign';
import { LABEL_UNTRUSTED } from '../../constants/labels';
import SafeMarkdown from './SafeMarkdown';
import { Orb, OrbGlyph } from '../ink/Orb';
import { InkLoader } from '../ink/InkLoader';

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
  <li className="flex flex-wrap items-baseline gap-x-2 text-12 text-ink-soft">
    <span className="font-mono text-navy">{call.tool}</span>
    <span>{call.isError ? 'failed, nothing assumed' : `${call.durationMs} ms`}</span>
    {hasUntrusted(call.output) && <span className="italic">fund text: {LABEL_UNTRUSTED}</span>}
  </li>
);

const AgentChat: React.FC<Props> = ({ transcript, sending, pendingMessage, liveToolCalls, turns, error, onSend, onNewConversation }) => {
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  // The orb pulses once when a reply lands, then goes back to breathing
  const [replied, setReplied] = useState(false);
  const wasSending = useRef(false);
  useEffect(() => {
    if (wasSending.current && !sending) {
      setReplied(true);
      const t = window.setTimeout(() => setReplied(false), 1700);
      wasSending.current = sending;
      return () => window.clearTimeout(t);
    }
    wasSending.current = sending;
  }, [sending]);

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
    <section className="ink-card flex h-full min-h-[32rem] flex-col text-navy" aria-label="Chat">
      <header className="flex items-center justify-between gap-3 border-b border-navy/10 px-4 py-3">
        <div className="flex items-center gap-3">
          <Orb size={40} state={sending ? 'thinking' : replied ? 'replied' : 'idle'} />
          <div>
            <p className="eyebrow">The agent</p>
            <h3 className="text-20 leading-tight">Conversation</h3>
          </div>
        </div>
        <div className="flex items-baseline gap-3 text-12 text-ink-soft">
          <span>
            Turns: <span className="tabular font-mono text-navy">{turns}</span>
          </span>
          <button onClick={onNewConversation} disabled={sending} className="text-cobalt underline-offset-4 hover:underline disabled:opacity-50">
            New conversation
          </button>
        </div>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 text-14">
        {transcript.length === 0 && !pendingMessage && (
          <p className="text-ink-soft">
            Describe what you want in one sentence. The agent asks only for what is missing and fills the mandate next to this chat.
            Nothing is valid until you approve it and sign.
          </p>
        )}
        {transcript.map((t, i) => (
          <div key={`${t.turn}-${t.role}-${i}`} className={t.role === 'investor' ? 'ml-8' : 'mr-8'}>
            <p className={`eyebrow mb-1 flex items-center gap-1.5 ${t.role === 'investor' ? 'justify-end' : ''}`}>
              {t.role === 'investor' ? 'You' : (<><OrbGlyph className="!h-3 !w-3" /> Agent</>)}
            </p>
            {t.role === 'investor' ? (
              <p className="whitespace-pre-wrap rounded-card rounded-tr-none bg-cobalt px-3.5 py-2.5 text-cream">{t.text}</p>
            ) : (
              <div className="module-panel rounded-card rounded-tl-none border border-navy/10 bg-cream px-3.5 py-2.5">
                <SafeMarkdown text={t.text} />
              </div>
            )}
          </div>
        ))}
        {pendingMessage && (
          <div className="ml-8">
            <p className="eyebrow mb-1 text-right">You</p>
            <p className="whitespace-pre-wrap rounded-card rounded-tr-none bg-cobalt px-3.5 py-2.5 text-cream">{pendingMessage}</p>
          </div>
        )}
        {sending && (
          <div className="mr-8 rounded-card border border-dashed border-navy/15 px-3.5 py-2.5">
            <InkLoader lines={[liveToolCalls.length ? 'Agent is working, tool calls so far:' : 'Agent is working...']} />
            {liveToolCalls.length > 0 && <ul className="mt-1 space-y-0.5">{liveToolCalls.map((c) => <ToolCallLine key={c.id} call={c} />)}</ul>}
          </div>
        )}
        {error && (
          <p className="text-12 text-vermilion" role="alert">
            {error}
          </p>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={submit} className="border-t border-navy/10 p-3">
        <div className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="I keep USDC and want to put 1,000 into receivables funds..."
            className="ink-input flex-1"
            maxLength={4000}
            disabled={sending}
          />
          <button type="submit" disabled={sending || !text.trim()} className="btn btn-md btn-primary">
            Send
          </button>
        </div>
      </form>
    </section>
  );
};

export default AgentChat;
