import React from 'react';
import Wordmark from './Wordmark';
import { Nib } from './ink/Nib';
import { BrushStroke } from './ink/BrushStroke';
import { LABEL_TEST_ASSETS, ONE_LINE, TAGLINE } from '../constants/labels';

/** Side panel of the sign in and register pages: the nib drawing itself, the tagline, the one line. */
const BrandHero: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`relative flex flex-col justify-center gap-6 overflow-hidden px-10 py-10 ${className}`}>
    <BrushStroke variant={3} className="absolute -right-24 -top-10 h-[420px] w-[420px] opacity-60" />
    <Wordmark size="lg" />
    <Nib size={200} className="-ml-4 hidden lg:block" />
    <div>
      <h1 className="max-w-lg text-40 md:text-56">{TAGLINE}</h1>
      <BrushStroke variant={2} className="mt-1 h-6 w-48" delay={0.6} />
    </div>
    <p className="max-w-md text-16 text-ink-soft">{ONE_LINE}</p>
    <p className="eyebrow">{LABEL_TEST_ASSETS}</p>
  </div>
);

export default BrandHero;
