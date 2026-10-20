# The deck: why it is built this way

This note explains the structure of `Countersign-Presentation-Deck.pdf`, slide by slide, and gives the spoken line for each slide when the deck is presented (final presentation: 10 minutes or less).

## Who reads it

The online review is asynchronous: an expert panel from WeBank and Tsinghua PBCSF reads dozens of entries, in English, often without the video. So every slide has to stand on its own: **a title that states a claim, not a topic**, and every number with its source on the slide.

What this panel has seen many times: "the LLM proposes, a policy decides", tier tables, allowlists, attack suites with counts. What makes it stop scrolling: a scenario it has not seen (the buy side of a receivables fund, on Stellar), a hash it can open, the February 2026 notice named before it asks, and investment subscription treated as the highest tier. What makes it discard an entry in ten seconds: return promises, "secure because the prompt forbids it", a persona presented as a testimonial. The target emotion is **trust**, not excitement.

## The arc

| Act | Slides | What the judge should take away |
|---|---|---|
| The question | 1 to 2 | The hardest thing for an agent is not talking about an investment; it is buying one |
| The pain | 3 to 5 | A real person gives up at one screen; real money is entering this market; agents have already lost money three different ways |
| The answer | 6 to 8 | One sentence; three parties; a card she can read before she signs |
| How it works | 9 to 11 | Who signs what, in order; how the agent understands, plans and corrects; where each piece runs |
| Why it holds | 12 to 15 | Each layer says what it holds and what it does not; tiers; 12 of 12 attacks blocked, 4 by the contract; 11 of 12 tasks completed |
| Proof | 16 to 17 | The decision hash travels with the money; every hash opens on a public explorer |
| Honesty | 18 to 19 | Compliance before you ask; where the prototype stops |
| Close | 20 to 22 | One benefit per stakeholder, what comes next, the team, the tagline |

## Slide by slide

| # | Title on the slide | Visual | Spoken line (about 25 seconds each) |
|---|---|---|---|
| 1 | Countersign | The nib drawing itself; team; track | "We are Countersign, International AI Track, Topic F, Agent Wallet." |
| 2 | What should an AI agent be allowed to sign for you? | The organiser's own tier table, investment subscription in Red | "This competition's banking brief already answers half of it: investment subscription is Red. So the hard part is not talking about an investment. It is buying one." |
| 3 | She gives up at 21:40 | Emotion curve of a composite persona | "Our persona is composite, built from public data. She keeps savings in USDC and gives up at one screen: the confirmation of her first purchase, irreversible and unreadable." |
| 4 | Retail money is entering receivables funds | ANBIMA growth, USDC trustlines, Greensill | "In Brazil, general investor accounts in receivables funds grew from 2.4 to 34.3 thousand in a year. The risk of these funds is existence and concentration." |
| 5 | A refusal in a prompt does not hold money | Freysa, AIXBT, Bybit | "Agents have lost money through a chat, through an operator panel, and through a signing screen that showed one thing while the transaction did another." |
| 6 | The one line | The nib, three strokes named: her mandate, the issuer, the wallet contract | "An investing agent that cannot buy a fund unit unless the investor's mandate, the fund's issuer and a wallet contract the agent cannot change agree." |
| 7 | Three parties, one wallet contract | The actors diagram | "She owns the wallet. The agent proposes and never holds a key. The issuer countersigns every mint." |
| 8 | She reads before she signs | Schematic of the approval card | "The card is decoded from the exact bytes she will sign, not written by the model, and it says who else must sign and what she could lose." |
| 9 | Who signs what, in order | Swimlanes of a first purchase | "Her signature, the policy's decision, the agent's purchase within her caps, the issuer's countersignature." |
| 10 | The agent asks only what is missing | Mandate, plan graph, tools | "One sentence becomes a typed mandate; the plan is a visible graph she can correct or stop." |
| 11 | The limits live where our server cannot reach | Architecture | "The agent service has no database and no keys; the limits are in a contract on Stellar." |
| 12 | Each layer says what it does not hold | Layers table | "We say where each layer stops, including our own server and our own contract." |
| 13 | The higher the stakes, the more hands on the pen | Tier ladder | "Green is automatic, Yellow is the agent within her mandate, Red is her signature, and the issuer signs every mint." |
| 14 | 12 of 12 blocked, and we name the layer | Adversarial cases | "Four of the attacks were refused on chain by our contract, even with the agent key in hand." |
| 15 | 11 of 12 completed, in 1.09 turns | Benign suite | "Forty percent of the score is task completion, so we measured it; the one error is declared, not hidden." |
| 16 | The decision travels with the money | Decision hash on chain | "Every agent purchase carries the hash of the log line that approved it." |
| 17 | Every hash has a task and a log line | Evidence numbers | "158 transactions, 37 of 37 decisions matched, 0 divergences, and a small mainnet slice with real USDC." |
| 18 | Compliance, before you ask | Perimeter, licence, simulated KYC, what the model sees | "Not offered in Mainland China; we name Yinfa [2026] No. 42; no licence; KYC simulated." |
| 19 | Where it stops | Limitation titles, pointer to the literal list | "Our contract is not audited; these are test assets; the full list is identical in every document." |
| 20 | One benefit per stakeholder | Investor, issuer, compliance; roadmap in "will" | "She signs only what she can read; the issuer keeps the mint; compliance gets a hash for every decision." |
| 21 | The team | Photos, roles, links | "Pablo, front end and product; Cecília, blockchain and backend." |
| 22 | Sign only what you can read. | The nib | "Countersign. Sign only what you can read." |

## Rules the deck follows

- Every number comes from the README, the documentation site or the evidence files, with its source on the slide.
- Every mention of the contract says it is ours and not audited; nothing says "the network enforces".
- No return figure; no "yield", "APY" or "guaranteed".
- The persona is always "composite persona, built from public data; not validated by interviews".
- The roadmap is in the future tense.
