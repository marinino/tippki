// Cache fuer die LLM-Recherche, nach dem Vorbild von data/odds_cache.json.
//
// Nie automatisch bei einem Seitenaufruf: ein Refresh kostet gemessen rund 0,37 $ (neun
// Partien auf claude-haiku-4-5 mit Websuche), und ein Seitenaufruf darf kein Geld
// verbrennen. Genau dieselbe Begruendung wie beim Quoten-Cache.

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { LlmMatchContext } from "./matchContext";

export interface CachedMatchContext {
  context: LlmMatchContext;
  sources: string[];
  model: string;
  fetchedAt: string;
}

// Was der Lauf tatsaechlich getan hat.
//
// Steht hier, weil das Fehlen dieser Zahlen den Ausfall von Spieltag 1 unsichtbar gemacht
// hat: der Cache enthielt neunmal "nichts gefunden", und aus dem Artefakt liess sich nicht
// entscheiden, ob recherchiert und nichts gefunden wurde oder ob nie eine Suche lief. Der
// Unterschied ist der ganze Punkt -- ohne ihn sieht ein stiller Fehlschlag der Automatik
// aus wie ein unauffaelliger Spieltag.
export interface LlmRunUsage {
  inputTokens: number;
  outputTokens: number;
  webSearches: number;
  costUsd: number;
  // Fehlercodes der Websuche, z.B. max_uses_exceeded. Nicht leer heisst: die Recherche
  // wurde beschnitten, der Nullbefund einzelner Partien ist also mit Vorsicht zu lesen.
  searchErrors: string[];
  // Laenge des Rechercheberichts in Zeichen.
  researchChars: number;
}

export interface LlmCacheFile {
  version: number;
  season: string;
  matchday: number;
  fetchedAt: string;
  model: string;
  // Schluessel wie beim Quoten-Cache: "Heimteam|Auswaertsteam".
  contexts: Record<string, CachedMatchContext>;
  // Partien, bei denen die Recherche fehlgeschlagen ist, mit Grund -- damit ein erneuter
  // Refresh nicht raten muss, was fehlt.
  failures?: Record<string, string>;
  // Optional, weil Dateien aus Version 1 sie nicht haben. Neue Laeufe schreiben sie immer.
  usage?: LlmRunUsage;
}

// 2 seit dem Umbau auf zwei Stufen (2026-09-01). Der Versionssprung wirft die Datei aus
// Spieltag 1 bewusst weg: sie enthaelt neun Nullbefunde aus einem Lauf, der nie gesucht
// hat, und die als Kontext weiterzureichen waere schlimmer als kein Kontext.
export const LLM_CACHE_VERSION = 2;

const CACHE_PATH = join(process.cwd(), "data", "llm_context_cache.json");

export function writeLlmCache(cache: LlmCacheFile): void {
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

// Liefert null, wenn nie aktualisiert wurde oder die Datei unlesbar ist -- die Vorhersage
// laeuft dann ohne LLM-Kontext weiter, wie ohne Quoten.
export function readLlmCache(): LlmCacheFile | null {
  if (!existsSync(CACHE_PATH)) return null;
  try {
    const parsed: LlmCacheFile = JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
    if (!parsed || typeof parsed.matchday !== "number" || !parsed.contexts) return null;
    if (parsed.version !== LLM_CACHE_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function cacheKey(homeTeam: string, awayTeam: string): string {
  return `${homeTeam}|${awayTeam}`;
}

// Was mit dem Spielkontext dieser Partie passiert ist.
//
// Bisher gab es dafuer nur ein Ja/Nein ("Korrektur angewandt?"), und das warf drei sehr
// verschiedene Faelle in denselben Topf: nie gefragt, gefragt und nichts gefunden, gefragt
// und gescheitert. Fuer die Beobachtung des Layers ist der Unterschied aber genau der
// Punkt -- laufen die Korrekturen gegen null, will man wissen, ob die Recherche inert ist
// oder ob sie gar nicht stattgefunden hat. Automatisch ausgeloest wird das noch wichtiger:
// ein stiller Fehlschlag der Automatik sieht sonst aus wie ein unauffaelliger Spieltag.
export type LlmStatus =
  | "nicht_recherchiert"
  | "fehlgeschlagen"
  | "ohne_befund"
  | "korrigiert";

// Der Cache muss bereits auf den gefragten Spieltag geprueft sein -- ein Kontext aus einem
// anderen Spieltag ist kein Kontext, sondern ein Fehler.
export function llmStatusOf(
  cacheForMatchday: LlmCacheFile | null,
  homeTeam: string,
  awayTeam: string,
  adjustmentApplied: boolean
): LlmStatus {
  if (!cacheForMatchday) return "nicht_recherchiert";
  const key = cacheKey(homeTeam, awayTeam);
  if (cacheForMatchday.contexts[key]) {
    return adjustmentApplied ? "korrigiert" : "ohne_befund";
  }
  if (cacheForMatchday.failures?.[key]) return "fehlgeschlagen";
  return "nicht_recherchiert";
}
