// Holt den Spielkontext fuer einen Spieltag und schreibt ihn in den Cache.
//
// Wird ausschliesslich manuell aufgerufen -- ueber POST /api/refresh-llm oder
// `npm run refresh-llm`. EIN Aufruf fuer den ganzen Spieltag: die Websuche ist der
// Kostenboden (10 USD je 1000 Anfragen, modellunabhaengig), und neun Einzelaufrufe
// wuerden neunmal denselben Themenraum absuchen.

import { readFileSync } from "fs";
import { join } from "path";
import { nextMatchdayOf, parseKickoff } from "../data/kickoff";
import { FORWARD_SEASON } from "../eval/splits";
import { fetchMatchdayContext, isLlmConfigured } from "./anthropicClient";
import { LLM_CACHE_VERSION, cacheKey, writeLlmCache, type LlmCacheFile } from "./llmCache";

interface Fixture {
  homeTeam: string;
  awayTeam: string;
  date: string;
  matchday: number;
}

export interface RefreshLlmSummary {
  matchday: number;
  fetchedAt: string;
  model: string;
  fixturesTotal: number;
  fixturesWithContext: number;
  fixturesWithFactors: number;
  failures: Record<string, string>;
  usage: { inputTokens: number; outputTokens: number; webSearches: number };
  estimatedCostUsd: number;
}

export async function refreshLlmContext(matchday?: number): Promise<RefreshLlmSummary> {
  if (!isLlmConfigured()) {
    throw new Error("ANTHROPIC_API_KEY fehlt. In .env.local eintragen, dann erneut versuchen.");
  }

  const fixturesPath = join(process.cwd(), "data", "fixtures.json");
  const allFixtures: Fixture[] = JSON.parse(readFileSync(fixturesPath, "utf-8"));

  const targetMatchday = matchday ?? nextMatchdayOf(allFixtures);

  if (targetMatchday == null) throw new Error("Kein kommender Spieltag gefunden.");

  const fixtures = allFixtures.filter((f) => f.matchday === targetMatchday);
  if (fixtures.length === 0) {
    throw new Error(`Spieltag ${targetMatchday} enthaelt keine Spiele.`);
  }

  const result = await fetchMatchdayContext(
    fixtures.map((f) => ({
      homeTeam: f.homeTeam,
      awayTeam: f.awayTeam,
      kickoff: parseKickoff(f.date),
    })),
    targetMatchday
  );

  if (!result.ok) {
    const detail = result.error.detail ? `${result.error.reason}: ${result.error.detail}` : result.error.reason;
    throw new Error(`Recherche fehlgeschlagen (${detail})`);
  }

  const contexts: LlmCacheFile["contexts"] = {};
  const failures: Record<string, string> = {};
  const fetchedAt = new Date().toISOString();
  let withFactors = 0;

  for (const fixture of fixtures) {
    const key = cacheKey(fixture.homeTeam, fixture.awayTeam);
    const found = result.value.contexts.get(key);
    if (!found) {
      // Ein Eintrag, der sich nicht eindeutig zuordnen liess, wird verworfen statt
      // geraten -- die Ausfaelle der falschen Mannschaft waeren schlimmer als keine.
      failures[key] = "keine zuordenbare Antwort";
      continue;
    }
    if (found.context.keyFactors.length > 0) withFactors++;
    contexts[key] = {
      context: found.context,
      sources: found.sources,
      model: result.value.model,
      fetchedAt,
    };
  }

  writeLlmCache({
    version: LLM_CACHE_VERSION,
    season: FORWARD_SEASON,
    matchday: targetMatchday,
    fetchedAt,
    model: result.value.model,
    contexts,
    failures: Object.keys(failures).length > 0 ? failures : undefined,
  });

  return {
    matchday: targetMatchday,
    fetchedAt,
    model: result.value.model,
    fixturesTotal: fixtures.length,
    fixturesWithContext: Object.keys(contexts).length,
    fixturesWithFactors: withFactors,
    failures,
    usage: result.value.usage,
    estimatedCostUsd: result.value.costUsd,
  };
}
