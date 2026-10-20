/**
 * Single source of every label the jury reads about what is real and what is simulated.
 * The README uses the same texts.
 * Do not type any of these strings anywhere else: import them from here.
 */

export const PRODUCT_NAME = 'Countersign';
export const TAGLINE = 'Sign only what you can read.';
/** One line summary, identical in README, technical document and video (condition 5) */
export const ONE_LINE =
  "An investing agent that cannot buy a fund unit unless the investor's mandate, the fund's issuer and a wallet contract the agent cannot change agree.";

export const LABEL_TEST_ASSETS =
  'test USDC on Stellar testnet and units of demonstration funds; no monetary value';

export const LABEL_FUNDS =
  'simulated funds and debtors; concentration and default data are synthetic';

export const LABEL_COMPLIANCE =
  'simulated checks, designed with reference to FINRA 2111, ESMA35-43-3172 and CSRC suitability measures';

export const LABEL_RECURRING =
  'run recurring now: pre-authorised within mandate. Time trigger simulated; the on-chain transaction is real';

export const LABEL_WALLET_CONTRACT = 'our wallet contract on Stellar testnet, not audited';

export const LABEL_ZK_TIER =
  'zero-knowledge proof of total invested on this platform; not a regulatory investor status';

/** No interview happened: always append LABEL_PERSONA_NOT_INTERVIEWED. */
export const LABEL_PERSONA = 'composite persona, built from public data';
export const LABEL_PERSONA_NOT_INTERVIEWED = '; not validated by interviews';

export const LABEL_UNTRUSTED = 'untrusted data, ignored';

// Permission tiers of the plan nodes. Shown as words only: colours stay reserved for states.
export const TIER_GREEN = 'Green: automatic, no signature';
export const TIER_YELLOW = 'Yellow: agent key, within your mandate';
export const TIER_RED = 'Red: your signature';
export const TIER_ISSUER = 'Issuer: fund wallet signature';

// Fixed texts of the approval card. Kept here so they exist once.

/** The network is not inside a Stellar envelope: this app states it out of band. */
export const NETWORK_LABEL = 'Stellar testnet';
export const NETWORK_NOTE = 'The network is not part of the transaction; this app states it separately.';
export const CARD_FOOTER_DECODED = 'Decoded from the transaction you will sign, not written by the agent';
export const CARD_ENFORCED =
  'The agent cannot change these limits. Enforced by our wallet contract on Stellar, not audited.';
export const CARD_FIRST_PURCHASE = 'First purchase in a new fund: your signature is required.';
