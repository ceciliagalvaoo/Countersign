# Demo video: shot list (5:00 or less, 16:9, 1080p, English narration and subtitles)

One video, the only video the call asks for. It follows the official guide: project and team, the core scenario end to end, then safety, results and limitations. Three kinds of shots:

- **P**: pitch animation, drawn in the product's hand. Made by Claude (`_source/animations.html`, recorded automatically).
- **W**: public web pages (landing, stellar.expert, GitHub, documentation). Recorded by Claude, no login.
- **U**: the product with a wallet. **Recorded by Pablo**, because every one has a Freighter signature or a logged in session.

Pablo drops his recordings in `raw/` with the exact file names below. Claude cuts, orders, subtitles and assembles `cut/InternationalAI-Countersign-DemoVideo.mp4`.

## How Pablo records the U shots

- Chrome at 1920x1080 (or full screen on a 1080p display), zoom 100%, Freighter on **Testnet**. Record the browser window only (QuickTime: File, New Screen Recording, select the window; or OBS).
- Log in **before** pressing record: no e-mail, password or key on screen. Hide the bookmarks bar.
- No narration needed while recording; the voice goes on afterwards. Move the mouse slowly; pause two seconds on every important screen.
- One file per shot. If a take goes wrong, record it again with the same name. The step numbers are the ones in `Roteiro Demo.md`.

## The shots, in the order of the video

| # | Time | Type | File (in `raw/` for U) | What is on screen | Narration (English) |
|---|---|---|---|---|---|
| 00 | 0:00 | **U** | `U00-card-cold-open.mov` | Roteiro step 8, item 2: the approval card of the first purchase, whole, slowly, **before** signing (8 to 10 s). Do not sign in this take | "Before her agent can buy anything new, she reads exactly what she signs." |
| 01 | 0:10 | P | | The nib draws itself; "Countersign · Sign only what you can read." | "This is Countersign." |
| 02 | 0:15 | P | | The organiser's own tiers: Green, Yellow, Red; "investment subscription" lights up in Red | "This competition's banking brief puts investment subscription in the red tier. The hard part for an agent is not talking about an investment. It is buying one." |
| 03 | 0:30 | P | | Her day: the curve drops to 21:40, the confirmation screen | "Our composite persona, built from public data and not validated by interviews, keeps savings in USDC. She gives up at one screen: the confirmation of her first purchase, irreversible and unreadable." |
| 04 | 0:48 | P | | Freysa, AIXBT, Bybit appear one by one | "Agents have already lost money through a chat, through an operator panel, and through a signing screen that showed one thing while the transaction did another." |
| 05 | 1:02 | P | | The one line, written stroke by stroke beside the nib | "So we built an investing agent that cannot buy a fund unit unless the investor's mandate, the fund's issuer and a wallet contract the agent cannot change agree." |
| 06 | 1:14 | P | | The three parties and the wallet contract, arrow by arrow | "The agent's wallet is a contract on Stellar: it can only pay fund wallets the investor approved, within limits she signed, and it cannot change those limits. Nobody holds a fund unit unless the fund's issuer signs the mint." |
| 07 | 1:30 | **U** | `U07-mandate.mov` | Steps 1 to 3: the agent page, paste the step 2 message, the mandate fills, **Approve mandate** | "She states her goal in one sentence. The agent asks only what is missing and fills a typed mandate. Nothing is valid until she approves it." |
| 08 | 1:48 | **U** | `U08-wallet-deploy.mov` | Step 5: **Review the deploy**, the card, sign in Freighter, "confirmed on-chain". Then step 6 (deposit), quickly | "Her mandate wallet is our wallet contract on Stellar, not audited. She deploys it with her caps, and deposits test USDC." |
| 09 | 2:02 | **U** | `U09-ask-and-correct.mov` | Step 7: paste "Please buy 5 USDC...", the fund facts, then "Make it 4." and the plan replans | "She asks for a purchase, then changes her mind. The plan is redone without starting over." |
| 10 | 2:16 | **U** | `U10-first-purchase-sign.mov` | Step 8, item 3: **Sign in your wallet**, Freighter, "confirmed on-chain" | "A first purchase in a new fund waits for her signature on a card decoded from the transaction bytes, not written by the model." |
| 11 | 2:28 | **U** | `U11-agent-buys.mov` | Step 9: **Tell the agent to continue**; "confirmed on chain, awaiting issuer countersignature"; the decision next to its log line; Evidence panel | "The agent executes within the mandate she signed. Our policy approved it, and the hash of that decision travels with the payment." |
| 12 | 2:44 | W | | stellar.expert: the purchase transaction, the `subscribe` call and its `decision` argument | "Anyone can open the transaction and see the decision on chain." |
| 13 | 2:54 | **U** | `U13-issuer-countersigns.mov` | Step 10: as the fund manager, **Investments**, **Approve**, two Freighter signatures, APPROVED; then back to the investor, ISSUER completed | "Nobody holds a fund unit until the fund's issuer countersigns the mint." |
| 14 | 3:10 | **U** | `U14-recurring-interrupt.mov` | Step 11: **Run recurring now**, the countdown, **Interrupt** | "Recurring purchases are pre-authorised within her mandate, and she can interrupt them. The time trigger is simulated; the transactions are real." |
| 15 | 3:22 | P + W | | The twelve attacks and the layer that held; then the FAILED A03 transaction on stellar.expert | "From our test suite: twelve adversarial cases, all blocked or recovered. Four were refused on chain by our wallet contract, even with the agent key in hand." |
| 16 | 3:40 | **U** | `U16-pause-and-revoke.mov` | Steps 12 and 13: the issuer pauses and resumes the units; she revokes the agent; **Run recurring now** is refused | "The issuer can freeze the units. She can revoke the agent with one signature; our wallet contract on Stellar, not audited, then refuses its purchases." |
| 17 | 3:56 | **U** | `U17-dock.mov` | Optional, 5 s: on Marketplace, the orb in the corner opens the same conversation | "And the agent is one click away on every screen." |
| 18 | 4:02 | P | | 11 of 12 tasks, 1.09 turns; 158 transactions, 37 of 37 decisions matched | "Eleven of twelve scripted tasks completed, in about one turn each. Every hash has a task and a log line." |
| 19 | 4:16 | P | | Compliance: Yinfa [2026] No. 42, no licence, simulated KYC, what the model sees | "Not offered in Mainland China; we name the February 2026 notice. No licence, simulated KYC, test assets." |
| 20 | 4:28 | W | | The documentation's Limitations page: the literal list, items 1 to 14, legible, in two screens | "These are our limitations, the same in every document." |
| 21 | 4:52 | P | | The nib; "Sign only what you can read." | "Countersign. Sign only what you can read." |

Total about 4:58. The text of every subtitle is the narration column.

## Status

Claude's 16 clips are recorded (`clips/`, 2:42 in total) and a first cut exists in `cut/`, with a cream card in place of each shot still to record. To stay under 5:00, Pablo's shots should come in close to these lengths (2:18 in total):

| Shot | Target length |
|---|---|
| U00 card cold open | 10 s |
| U07 mandate | 18 s |
| U08 wallet deploy and deposit | 14 s |
| U09 ask and correct | 14 s |
| U10 first purchase signature | 12 s |
| U11 agent buys | 16 s |
| U13 issuer countersigns | 16 s |
| U14 recurring and interrupt | 12 s |
| U16 pause and revoke | 16 s |
| U17 dock (optional) | 5 s |

Longer takes are fine: Claude cuts the waiting (the agent thinking, the Freighter popup loading) when it assembles. Run `python3 _source/assemble.py` again after adding files; it warns if the cut passes 5:00.


1. The nine **U** files above (U00, U07, U08, U09, U10, U11, U13, U14, U16; U17 is optional). They follow `Roteiro Demo.md` Part 1 in that order, so one pass through the roteiro produces them all: start a new file at each shot.
2. The narration: read the narration column into one audio file per shot, or one take of the whole script (`raw/narration.m4a`). A quiet room and a phone held close are enough.
3. Write down the hash of the purchase in step 9 (the "Latest agent purchase" link) so shot 12 shows that same transaction.

When the files are in `raw/`, ask Claude to check them: it watches every file, checks length and what is on screen, and lists any take to redo before it assembles the cut.
