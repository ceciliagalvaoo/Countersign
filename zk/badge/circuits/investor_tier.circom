pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/bitify.circom";

// Proves that an investor's committed total invested reaches a tier threshold without revealing the total.
//
// The platform computes commitment = Poseidon(totalCents, salt) from the investor's verified orders and attests it
// (ed25519 signature checked by the BadgeVerifier contract). The investor proves knowledge of the opening and that
// totalCents >= threshold. Public signals, in order: [commitment, threshold].
template InvestorTier(nBits) {
    signal input totalCents; // private
    signal input salt;       // private
    signal input commitment; // public
    signal input threshold;  // public, in USDC cents

    component hash = Poseidon(2);
    hash.inputs[0] <== totalCents;
    hash.inputs[1] <== salt;
    commitment === hash.out;

    // Range-check both values so the comparison cannot wrap around the field
    component totalBits = Num2Bits(nBits);
    totalBits.in <== totalCents;
    component thresholdBits = Num2Bits(nBits);
    thresholdBits.in <== threshold;

    component gte = GreaterEqThan(nBits);
    gte.in[0] <== totalCents;
    gte.in[1] <== threshold;
    gte.out === 1;
}

component main {public [commitment, threshold]} = InvestorTier(64);
