// Cache fuer die LLM-Recherche, nach dem Vorbild von data/odds_cache.json.
//
// Manuelles Aktualisieren, nie automatisch bei einem Seitenaufruf: ein Refresh kostet ~1 $
// (9 Partien auf claude-opus-5 mit Websuche), und ein Seitenaufruf darf kein Geld
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
}

export const LLM_CACHE_VERSION = 1;

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
