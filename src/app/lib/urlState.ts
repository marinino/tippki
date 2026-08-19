// Tab und Spieltag in der Adresszeile.
//
// Bewusst ueber history.pushState statt useSearchParams: der Next-Hook zwingt die
// Seite in eine Suspense-Grenze und loest bei jeder Aenderung ein Router-Update aus.
// Hier soll sich nur die Adresse aendern, nicht der Renderpfad.

import type { Tab } from "../types";

const TABS: Tab[] = ["predictions", "table", "backtest", "simulate", "data"];

// Deutsche Namen in der Adresse, damit ein geteilter Link lesbar bleibt.
const TAB_SLUGS: Record<Tab, string> = {
  predictions: "tipps",
  table: "tabelle",
  backtest: "backtest",
  simulate: "simulieren",
  data: "daten",
};

const SLUG_TO_TAB: Record<string, Tab> = Object.fromEntries(
  TABS.map((t) => [TAB_SLUGS[t], t])
);

export interface UrlState {
  tab: Tab;
  matchday: number | null;
}

export function readUrlState(fallbackTab: Tab): UrlState {
  if (typeof window === "undefined") return { tab: fallbackTab, matchday: null };
  const params = new URLSearchParams(window.location.search);
  const matchday = Number(params.get("spieltag"));
  return {
    tab: SLUG_TO_TAB[params.get("tab") ?? ""] ?? fallbackTab,
    matchday: Number.isInteger(matchday) && matchday > 0 ? matchday : null,
  };
}

export function writeUrlState(state: UrlState): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams();
  if (state.tab !== "predictions") params.set("tab", TAB_SLUGS[state.tab]);
  if (state.matchday != null) params.set("spieltag", String(state.matchday));

  const query = params.toString();
  const next = query ? `${window.location.pathname}?${query}` : window.location.pathname;
  if (next === window.location.pathname + window.location.search) return;
  window.history.pushState(null, "", next);
}
