import React from 'react';

/**
 * Minimal markdown for agent messages, rendered as React nodes (never as HTML): paragraphs, line breaks,
 * bullet and numbered lists, **bold**, *italic* or _italic_, and `inline code`. Anything else stays as the
 * literal text, so a tag written by the model or planted in fund data is shown as text and never executed.
 */

const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/g;

function inline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith('`')) {
      out.push(
        <code key={key} className="rounded bg-white/10 px-1 font-mono text-[0.85em]">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith('**') || tok.startsWith('__')) {
      out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    } else {
      // Single underscores inside words (snake_case names) are not italics
      const before = at > 0 ? text[at - 1] : ' ';
      if (tok.startsWith('_') && /\w/.test(before)) {
        out.push(tok);
      } else {
        out.push(<em key={key}>{tok.slice(1, -1)}</em>);
      }
    }
    last = at + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function withBreaks(lines: string[], keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  lines.forEach((l, i) => {
    if (i > 0) out.push(<br key={`${keyBase}-br-${i}`} />);
    out.push(...inline(l, `${keyBase}-${i}`));
  });
  return out;
}

type Block = { kind: 'p'; lines: string[] } | { kind: 'ul' | 'ol'; items: string[] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

function blocks(text: string): Block[] {
  const out: Block[] = [];
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.replace(/^#{1,6}\s+/, '');
    const b = BULLET.exec(line);
    const n = b ? null : NUMBERED.exec(line);
    const last = out[out.length - 1];
    if (b || n) {
      const kind = b ? 'ul' : 'ol';
      const item = (b ?? n)![1];
      if (last && last.kind === kind) last.items.push(item);
      else out.push({ kind, items: [item] });
    } else if (line.trim() === '') {
      out.push({ kind: 'p', lines: [] });
    } else if (last && last.kind === 'p' && last.lines.length > 0) {
      last.lines.push(line);
    } else {
      out.push({ kind: 'p', lines: [line] });
    }
  }
  return out.filter((b) => (b.kind === 'p' ? b.lines.length > 0 : b.items.length > 0));
}

const SafeMarkdown: React.FC<{ text: string }> = ({ text }) => (
  <div className="space-y-2">
    {blocks(text).map((b, i) => {
      if (b.kind === 'p') return <p key={i}>{withBreaks(b.lines, `p${i}`)}</p>;
      const items = b.items.map((it, j) => <li key={j}>{inline(it, `l${i}-${j}`)}</li>);
      return b.kind === 'ul' ? (
        <ul key={i} className="list-disc space-y-0.5 pl-5">
          {items}
        </ul>
      ) : (
        <ol key={i} className="list-decimal space-y-0.5 pl-5">
          {items}
        </ol>
      );
    })}
  </div>
);

export default SafeMarkdown;
