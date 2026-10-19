// Optional demo catalog: fixed, reviewed texts per demo fund (illustrative
// return wording and loss scenario), keyed by fund symbol. These texts are ours
// (repository content reviewed by compliance), so they are not marked as
// untrusted; fund descriptions written by managers are.
//
// Expected file format (apps/api/scripts/countersign-demo-funds.json):
//   { "funds": [ { "symbol": "AGRI1", "label": "LABEL_FUNDS",
//                  "illustrativeReturnText": "...", "lossScenarioText": "...",
//                  "eligibilityText": "...", "liquidityText": "..." } ] }
// Any other keys in the file (seed data for the API) are ignored here.
import { readFileSync } from "node:fs";
import { config } from "../config.js";

export interface CatalogEntry {
  symbol: string;
  label?: string;
  illustrativeReturnText?: string;
  lossScenarioText?: string;
  eligibilityText?: string;
  liquidityText?: string;
}

let cache: Map<string, CatalogEntry> | undefined;

export function loadCatalog(path = config.demoCatalogPath): Map<string, CatalogEntry> {
  if (cache) return cache;
  const map = new Map<string, CatalogEntry>();
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { funds?: unknown };
    if (Array.isArray(raw.funds)) {
      for (const f of raw.funds as CatalogEntry[]) {
        if (f && typeof f.symbol === "string") map.set(f.symbol.toUpperCase(), f);
      }
    }
  } catch {
    // No catalog yet: generic fixed texts are used.
  }
  cache = map;
  return map;
}

/** Test hook: replace the catalog in memory. */
export function setCatalogForTests(entries: CatalogEntry[] | undefined): void {
  cache = entries ? new Map(entries.map((e) => [e.symbol.toUpperCase(), e])) : undefined;
}
