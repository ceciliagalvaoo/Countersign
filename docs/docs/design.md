---
id: design
title: Design
sidebar_position: 7
---

# Design

Countersign is drawn in ink on cream. The interface has one job, which is in its tagline: *Sign only what you can read.* Every visual decision below serves that job, and the same tokens paint the web app (`apps/new_web/tailwind.config.js`) and this site (`docs/src/css/custom.css`).

## The nib

<div className="cs-figure">

![The Countersign nib: two flanks and a slit that meet at one point, and the signature that leaves it](/img/brand/nib.svg)

*Figure 1. The nib. It draws itself in, stroke by stroke, on the landing page and the sign in page.*

</div>

The mark is a fountain pen nib drawn from three strokes that meet at one point. The left flank is the investor's mandate, the right flank is the fund's issuer, and the slit is the wallet contract the agent cannot change, our contract on Stellar (not audited). Ink reaches the paper only where all three meet, which is the one line summary drawn as a picture: *an investing agent that cannot buy a fund unit unless the investor's mandate, the fund's issuer and a wallet contract the agent cannot change agree.* The stroke that leaves the tip is the signature, written on a signature line.

The nib is drawn in the same hand as every other stroke in the product: one weight, round caps, never a filled shape. A heavier version sits beside the wordmark and in the favicon.

## Palette

| Token | Value | What it means |
|---|---|---|
| Cream | `#F4F0E5` | The page |
| Cream deep | `#EBE5D6` | Cards and wells |
| Navy | `#1B2B6B` | Text, and every number |
| Ink soft | `#5A679E` | Secondary text and labels |
| Cobalt | `#2547C9` | The hand that acts: buttons, links, a confirmed signature |
| Ochre | `#A06A12` | Waiting: awaiting your signature, pending, awaiting issuer countersignature |
| Vermilion | `#C0391B` | Refused: by the policy or by our wallet contract |

Colour marks a state and always sits next to the word for that state; it is never the only signal. Amounts, prices and balances stay in navy: no figure is ever coloured as a gain or a loss.

## Type

- **Cormorant Garamond** for headings, the approval card's title and the sentence "The agent cannot change these limits."
- **Inter** for text and controls; small caps labels (eyebrows) above each section.
- **IBM Plex Mono** for amounts, hashes, addresses and function names, with tabular figures so columns line up.

All three are loaded from Google Fonts under the SIL Open Font License 1.1.

## Where the agent is

The agent is shown as an orb: a sphere of blue light, the only gradient in the product. It breathes while it waits, its light runs faster while it calls its tools, and it pulses once when a reply lands. A small orb glyph marks everything the agent wrote: its messages and the mandate draft it filled from the investor's words.

On every investor screen, an orb in the corner opens the same conversation in a side panel, so she can ask a question wherever she is. The panel proposes and answers; it signs nothing, and when a signature is waiting it sends her to the agent page. It is not shown to the fund manager: the agent has no manager tools, by design.

**The orb never appears on the approval card.** The card is decoded from the transaction the investor will sign, not written by the agent, and the design keeps that visible: where the model was, there is an orb; where the bytes are, there is none.

## Motion

| Gesture | Where | What it says |
|---|---|---|
| A stroke paints itself in, once, and stays | The nib, the underline under each headline | Drawn by hand, not generated |
| One pen stroke wanders the margins, painting itself slowly and fading before the next | Behind every screen, at low opacity | A hand at work, never more than one mark at a time |
| The empty signature line breathes in ochre | Each "Who must sign" row of the approval card | Your signature is still missing |
| The signature is drawn in cobalt on the line | The same row, after the ledger confirms | Signed, confirmed on-chain |
| Three short strokes draw one by one | Anything that takes a beat | Working; never a spinner |
| Panels rise a few pixels as they open | The approval card, dialogs, new agent messages | Something arrived |

Every animation stops for a reader who asked the system for reduced motion.
