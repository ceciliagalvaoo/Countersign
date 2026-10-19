import React from 'react';
import Wordmark from './Wordmark';
import { LABEL_TEST_ASSETS, ONE_LINE, TAGLINE } from '../constants/labels';

/** Side panel of the sign in and register pages: app background, wordmark, tagline, one line summary */
const BrandHero: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`flex flex-col justify-center gap-6 px-10 py-10 text-white ${className}`}>
    <Wordmark className="text-3xl text-white" />
    <p className="text-2xl font-semibold text-white">{TAGLINE}</p>
    <p className="max-w-md text-sm text-white/80">{ONE_LINE}</p>
    <p className="text-[11px] text-white/60">{LABEL_TEST_ASSETS}</p>
  </div>
);

export default BrandHero;
