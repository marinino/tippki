// Holt den Spielkontext fuer einen Spieltag und schreibt ihn in den Cache.
//
// Ausgeloest von der Automatik (Workflow spielkontext.yml, drei Stunden vor dem ersten
// Anpfiff) oder im Ausnahmefall ueber POST /api/refresh-llm bzw. `npm run refresh-llm`.
//
// EIN suchender Aufruf fuer den ganzen Spieltag, danach mehrere billige Extraktionen je
// drei Partien -- die Aufteilung und ihre Messwerte stehen in matchContext.ts. Gesucht
// wird nur einmal, weil die Suche linear der Kostentreiber ist.

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
  searchErrors: string[];
  researchChars: number;
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
    // Der Cache wird bei einem Fehlschlag NICHT geschrieben. Ein halb gefuellter oder ein
    // aus dem Nichts extrahierter Cache waere schaedlicher als gar keiner: forward-log
    // liest ihn und protokolliert den erfundenen Nullbefund als echte Vorhersage, und das
    // Log ist append-only.
    if (result.error.reason === "no_search") {
      throw new Error(
        `Recherche hat keine einzige Websuche abgesetzt -- nichts geschrieben. ` +
          `Ohne Suche gaebe es fuer jede Partie ein erfundenes "nichts gefunden". ` +
          `(${result.error.detail ?? "kein Detail"})`
      );
    }
    if (result.error.reason === "budget_exhausted") {
      throw new Error(
        `Suchbudget erschoepft und kein einziger Faktor gefunden -- nichts geschrieben.\n` +
          `Das ist die Signatur des Aufgebens: das Modell laeuft ins max_uses-Limit und\n` +
          `meldet danach fuer JEDE Partie "nichts gefunden". MAX_SEARCHES in\n` +
          `src/llm/anthropicClient.ts anheben und erneut ausloesen.\n` +
          `(${result.error.detail ?? "kein Detail"})`
      );
    }
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
      // Zwei verschiedene Gruende, und der Unterschied gehoert in den Cache: entweder ist
      // der ganze Extraktionsblock gescheitert (dann steht der echte Grund in
      // blockFailures), oder die Antwort liess sich nicht eindeutig zuordnen und wurde
      // verworfen statt geraten -- die Ausfaelle der falschen Mannschaft waeren schlimmer
      // als keine.
      failures[key] = result.value.blockFailures[key] ?? "keine zuordenbare Antwort";
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
    // Immer mitgeschrieben, auch und gerade wenn nichts gefunden wurde: nur so laesst sich
    // spaeter entscheiden, ob der Nullbefund einer war.
    usage: {
      ...result.value.usage,
      costUsd: result.value.costUsd,
      searchErrors: result.value.searchErrors,
      researchChars: result.value.researchChars,
    },
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
    searchErrors: result.value.searchErrors,
    researchChars: result.value.researchChars,
  };
}
