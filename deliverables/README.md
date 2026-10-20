# Countersign: submission deliverables

2026 Shenzhen FinTechathon, International AI Track, Topic F (Agent Wallet). The six items of the call, in its order. Every PDF follows the section titles of the official template.

| # | Item | File | Status |
|---|---|---|---|
| 1 | Technical documentation | [`01-technical-document/Countersign-Technical-Document.pdf`](01-technical-document/Countersign-Technical-Document.pdf) | Ready |
| 2 | Presentation deck (10 minutes or less) | [`02-presentation-deck/Countersign-Presentation-Deck.pdf`](02-presentation-deck/Countersign-Presentation-Deck.pdf) · narrative and spoken lines in [`STORY.md`](02-presentation-deck/STORY.md) | Ready |
| 3 | Demo video (5 minutes or less) | [`03-demo-video/`](03-demo-video/README.md) | To record |
| 4 | Source code | This repository; [`README.MD`](../README.MD) follows the official README template | Ready |
| 5 | Security self-assessment | [`05-security-self-assessment/Countersign-Security-Self-Assessment.pdf`](05-security-self-assessment/Countersign-Security-Self-Assessment.pdf) | Ready |
| 6 | Execution evidence | [`06-execution-evidence/Countersign-Execution-Evidence.pdf`](06-execution-evidence/Countersign-Execution-Evidence.pdf) · source table in [`evidence/EVIDENCE.md`](../evidence/EVIDENCE.md) | Ready |
| | Team registration form | [`team-form/`](team-form/README.md): kept off the public repository (passport and phone numbers) | Sent by email |

## Figures

Every diagram and chart is in [`figures/`](figures) as PNG, drawn in the product's own hand (Ink on Cream): the three parties, the architecture, a first purchase in swimlanes, who enforces what, the permission tiers, both test suites, the persona's day, the market, the decision hash on chain and the evidence in numbers. All numbers come from the README, the documentation site and the evidence files, with their sources.

## Rebuilding

The PDFs and PNGs are generated from [`_source/`](_source): `ink.css` and `ink.js` (tokens and hand-drawn primitives), `figures.html`, `deck.html`, and `build_docs.py`, which copies the README's tables and the literal limitations block into the documents so they stay identical.

```bash
cd deliverables/_source
python3 build_docs.py                      # needs the markdown package
CHROME_PATH=/path/to/chromium node render.mjs all   # needs playwright-core
```
