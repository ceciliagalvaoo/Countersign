import React from 'react';
import { Link } from 'react-router-dom';
import Wordmark from '../../components/Wordmark';
import { LABEL_TEST_ASSETS, LABEL_WALLET_CONTRACT, ONE_LINE, TAGLINE } from '../../constants/labels';

/** Public landing page: name, tagline, the one line summary and the way in. Nothing else. */
const HomePage: React.FC = () => (
  <div className="flex min-h-screen flex-col bg-[#020617] bg-[radial-gradient(circle_at_top,_#134e4a_0,_#020617_55%,_#020617_100%)] text-white">
    <header className="flex items-center justify-between px-6 py-5 md:px-12">
      <Wordmark className="text-xl text-white" />
      <Link to="/login" className="rounded border border-white/40 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10">
        Sign in
      </Link>
    </header>
    <main className="flex flex-1 items-center px-6 md:px-12">
      <div className="max-w-3xl space-y-6">
        <h1 className="text-4xl font-semibold !text-white md:text-5xl">{TAGLINE}</h1>
        <p className="text-lg text-white/85">{ONE_LINE}</p>
        <div className="flex flex-wrap gap-3">
          <Link to="/register" className="rounded bg-white/[0.04] px-5 py-2.5 text-sm font-semibold text-gray-100">
            Create an account
          </Link>
          <Link to="/login" className="rounded border border-white/40 px-5 py-2.5 text-sm font-semibold text-white">
            Sign in
          </Link>
        </div>
      </div>
    </main>
    <footer className="space-y-1 px-6 py-5 text-[11px] text-white/60 md:px-12">
      <p>
        Test assets: {LABEL_TEST_ASSETS}.
      </p>
      <p>Mandate wallet: {LABEL_WALLET_CONTRACT}.</p>
    </footer>
  </div>
);

export default HomePage;
