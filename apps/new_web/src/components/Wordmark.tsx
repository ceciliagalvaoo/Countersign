import React from 'react';
import { PRODUCT_NAME } from '../constants/labels';

/** Product wordmark in the app's own sans font, bold; icon only when compact */
const Wordmark: React.FC<{ className?: string; compact?: boolean }> = ({ className = '', compact = false }) => (
  <span className={`inline-flex items-center gap-2 font-bold tracking-tight ${className}`}>
    <img src="/countersign.svg" alt="" aria-hidden="true" className="h-8 w-8" />
    {!compact && <span>{PRODUCT_NAME}</span>}
  </span>
);

export default Wordmark;
