import React from 'react';
import { Link } from 'react-router-dom';
import Wordmark from '../../components/Wordmark';
import { Nib } from '../../components/ink/Nib';
import { BrushStroke } from '../../components/ink/BrushStroke';
import { Reveal } from '../../components/ink/Reveal';
import { AmbientStroke } from '../../components/ink/AmbientStroke';
import {
  CARD_FOOTER_DECODED,
  LABEL_TEST_ASSETS,
  LABEL_WALLET_CONTRACT,
  ONE_LINE,
  TAGLINE,
} from '../../constants/labels';

const DOCS_URL = 'https://ceciliagalvaoo.github.io/Countersign/';

/** The three strokes of the nib, one per party that has to agree. Sentences from the README. */
const HANDS = [
  {
    eyebrow: 'Left stroke',
    title: 'Her mandate',
    body: 'She approves the mandate, and every first purchase in a new fund waits for a card she can read and sign.',
  },
  {
    eyebrow: 'Right stroke',
    title: "The fund's issuer",
    body: "Nobody holds a fund unit unless the fund's issuer signs the mint. Until then the screen says awaiting issuer countersignature.",
  },
  {
    eyebrow: 'The slit',
    title: 'A wallet contract',
    body: "The agent's wallet is a contract on Stellar: it can only pay fund wallets the investor approved, within limits she signed, and it cannot change those limits. Ours, not audited.",
  },
];

/** Public landing page: the nib, the tagline, the one line summary and the way in. */
const HomePage: React.FC = () => (
  <div className="relative flex min-h-screen flex-col bg-cream text-navy">
    <AmbientStroke />

    <header className="mx-auto flex w-full max-w-[1100px] items-center justify-between px-6 py-6">
      <Wordmark />
      <nav className="flex items-center gap-2">
        <a href={DOCS_URL} className="btn btn-sm btn-ghost">
          Documentation
        </a>
        <Link to="/login" className="btn btn-sm btn-secondary">
          Sign in
        </Link>
      </nav>
    </header>

    <main className="flex-1">
      {/* Hero */}
      <section className="relative mx-auto grid w-full max-w-[1100px] items-center gap-10 px-6 py-14 md:grid-cols-[1.25fr_1fr] md:py-24">
        <div className="space-y-7">
          <p className="eyebrow">An agent wallet on Stellar</p>
          <div>
            <h1 className="text-56 md:text-72">{TAGLINE}</h1>
            <BrushStroke variant={2} className="mt-2 h-7 w-60" delay={0.5} />
          </div>
          <p className="max-w-xl text-20 text-ink-soft">{ONE_LINE}</p>
          <div className="flex flex-wrap gap-3">
            <Link to="/register" className="btn btn-md btn-primary">
              Create an account
            </Link>
            <Link to="/login" className="btn btn-md btn-secondary">
              Sign in
            </Link>
          </div>
        </div>
        <div className="relative flex justify-center">
          <BrushStroke variant={4} className="absolute inset-x-0 top-1/2 h-64 w-full -translate-y-1/2 opacity-25" delay={1.4} />
          <Nib size="min(340px, 70vw)" title="The Countersign nib: three strokes that meet at one point" />
        </div>
      </section>

      {/* Three hands */}
      <section className="hairline">
        <div className="mx-auto w-full max-w-[1100px] px-6 py-14 md:py-24">
          <Reveal>
            <p className="eyebrow">Three strokes, one point</p>
            <h2 className="mt-2 max-w-2xl text-40">Ink only reaches the paper where all three agree.</h2>
          </Reveal>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {HANDS.map((h, i) => (
              <Reveal key={h.title} delay={0.08 * i} className="ink-card p-6">
                <p className="eyebrow">{h.eyebrow}</p>
                <h3 className="mt-2 text-28">{h.title}</h3>
                <p className="mt-3 text-14 text-ink-soft">{h.body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* The card */}
      <section className="hairline">
        <div className="mx-auto grid w-full max-w-[1100px] gap-10 px-6 py-14 md:grid-cols-2 md:py-24">
          <Reveal>
            <p className="eyebrow">Before every first purchase</p>
            <h2 className="mt-2 text-40">A card she can read, then her signature.</h2>
            <p className="mt-4 text-16 text-ink-soft">
              Every first purchase in a new fund waits for a card she can read and sign. The card shows the network, the
              contract, the function, the fund, the cap and what she could lose. The agent cannot change these limits.
            </p>
          </Reveal>
          <Reveal delay={0.1} className="ink-card self-start p-6">
            <p className="eyebrow">What you sign</p>
            <dl className="mt-4 space-y-3 text-14">
              <div className="flex justify-between gap-4">
                <dt className="text-ink-soft">Network</dt>
                <dd>Stellar testnet</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-soft">Function</dt>
                <dd className="font-mono">allow_fund</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-soft">Who signs</dt>
                <dd>You, then the issuer on each mint</dd>
              </div>
            </dl>
            <BrushStroke variant={5} className="mt-6 h-16 w-56" delay={0.3} />
            <p className="mt-2 text-12 text-ink-soft">{CARD_FOOTER_DECODED}.</p>
          </Reveal>
        </div>
      </section>
    </main>

    <footer className="hairline">
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-2 px-6 py-8 text-12 text-ink-soft md:flex-row md:justify-between">
        <div className="space-y-1">
          <p>Test assets: {LABEL_TEST_ASSETS}.</p>
          <p>Mandate wallet: {LABEL_WALLET_CONTRACT}.</p>
        </div>
        <a href={`${DOCS_URL}limitations`} className="text-cobalt underline-offset-4 hover:underline">
          Known limitations
        </a>
      </div>
    </footer>
  </div>
);

export default HomePage;
