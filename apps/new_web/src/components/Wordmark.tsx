import React from 'react';
import { PRODUCT_NAME } from '../constants/labels';
import { NibGlyph } from './ink/Nib';

/** The wordmark: the nib glyph, then the name in the display face. Glyph only when compact. */
const Wordmark: React.FC<{ className?: string; compact?: boolean; size?: 'sm' | 'md' | 'lg' }> = ({
  className = '',
  compact = false,
  size = 'md',
}) => {
  const text = size === 'lg' ? 'text-28' : size === 'sm' ? 'text-16' : 'text-20';
  const glyph = size === 'lg' ? 'h-9' : size === 'sm' ? 'h-5' : 'h-7';
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <NibGlyph className={`${glyph} w-auto`} />
      {!compact && (
        <span className={`whitespace-nowrap font-display font-semibold tracking-[0.01em] text-navy ${text}`}>{PRODUCT_NAME}</span>
      )}
    </span>
  );
};

export default Wordmark;
