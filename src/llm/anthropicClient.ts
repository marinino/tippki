// Anbindung an die Claude-API fuer die Spielkontext-Recherche.
//
// EHRLICHE RAHMUNG, bevor irgendwer diesem Layer etwas zutraut:
//
// Die Buchmacherquoten preisen Verletzungen, Aufstellungen, Belastung und Motivation
// bereits ein -- das ist buchstaeblich die Aufgabe des Marktes, und er erledigt sie mit
// besserer Information als ein websuchendes Sprachmodell. Der Marktabstand des Modells
// betraegt 0.0063 RPS, und `npm run market-gap` zeigt: in den Faellen, in denen Modell und
// Markt auseinanderliegen, hat systematisch der Markt recht. Dieser Layer greift genau die
// Informationsluecke an, die dafuer verantwortlich ist -- aber mit einer schlechteren
// Informationsbasis als der Markt.
//
// Der Wert liegt deshalb dort, wo keine Quoten vorliegen (frueher Spieltag, Simulator),
// und als kleine geklammerte Korrektur. Nicht als Edge-Quelle.
//
// Warum die direkte Anthropic-API und nicht OpenRouter: die serverseitige Websuche laeuft
// auf Anthropics Infrastruktur und liefert Ergebnisse samt Quell-URLs zurueck. Ueber einen
// OpenAI-kompatiblen Umweg waere die Such-API eine Vermutung.
//
// EIN Aufruf je Spieltag, nicht je Partie: die Websuche kostet 10 USD je 1000 Anfragen und
// ist damit der Kostenboden -- neun Einzelaufrufe suchen neunmal denselben Themenraum ab.
// Die Buendelung spart rund drei Viertel und damit mehr als jeder Modellwechsel.

import Anthropic from "@anthropic-ai/sdk";
import {
  MATCHDAY_CONTEXT_SCHEMA,
  SYSTEM_PROMPT,
  buildMatchdayPrompt,
  isValidMatchdayContext,
  type FixtureForPrompt,
  type LlmMatchContext,
} from "./matchContext";
import { estimateCostUsd, resolveModelProfile, type ModelProfile } from "./modelProfile";

// Der ganze Spieltag plus Suchergebnisse muss hineinpassen.
const MAX_TOKENS = 16000;

// Gebuendelt darf das Modell mehr suchen als bei einer Einzelpartie -- aber deutlich
// weniger als neun Einzelaufrufe zusammen gebraucht haetten.
const MAX_SEARCHES = 10;

// Serverseitige Tools laufen in einer eigenen Sampling-Schleife. Erreicht die ihr Limit,
// kommt stop_reason "pause_turn" zurueck und der Aufruf muss fortgesetzt werden -- ohne
// zusaetzliche Nutzernachricht, die API erkennt die Fortsetzung selbst.
const MAX_CONTINUATIONS = 4;

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  webSearches: number;
}

export interface MatchdayResult {
  // Schluessel: "Heimteam|Auswaertsteam", bereits auf unsere Teamnamen zurueckgemappt.
  contexts: Map<string, { context: LlmMatchContext; sources: string[] }>;
  usage: LlmUsage;
  costUsd: number;
  model: string;
}

export interface LlmFailure {
  reason: "no_api_key" | "refusal" | "invalid_output" | "api_error" | "truncated";
  detail?: string;
}

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!cachedClient) cachedClient = new Anthropic();
  return cachedClient;
}

export function isLlmConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function activeModel(): string {
  return resolveModelProfile().model;
}

// Liefert bei JEDEM Problem einen Fehler statt zu werfen -- fehlender Key, Verweigerung,
// ungueltige Ausgabe, Netzfehler. Dieselbe defensive Haltung wie fetchOddsForFixtures:
// die App muss ohne LLM identisch funktionieren.
export async function fetchMatchdayContext(
  fixtures: FixtureForPrompt[],
  matchday: number
): Promise<{ ok: true; value: MatchdayResult } | { ok: false; error: LlmFailure }> {
  const client = getClient();
  if (!client) return { ok: false, error: { reason: "no_api_key" } };
  if (fixtures.length === 0) {
    return { ok: false, error: { reason: "api_error", detail: "keine Partien uebergeben" } };
  }

  const profile = resolveModelProfile();
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: buildMatchdayPrompt(fixtures, matchday) },
  ];

  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0, webSearches: 0 };

  try {
    for (let attempt = 0; attempt <= MAX_CONTINUATIONS; attempt++) {
      const response = await client.messages.create({
        model: profile.model,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages,
        tools: [{ type: profile.webSearchType, name: "web_search", max_uses: MAX_SEARCHES }],
        output_config: {
          // effort wird von Haiku 4.5 mit einem Fehler quittiert, deshalb nur setzen,
          // wo das Modell es kennt.
          ...(profile.supportsEffort ? { effort: "medium" as const } : {}),
          format: { type: "json_schema", schema: MATCHDAY_CONTEXT_SCHEMA },
        },
      });

      usage.inputTokens += response.usage.input_tokens;
      usage.outputTokens += response.usage.output_tokens;
      usage.webSearches += response.usage.server_tool_use?.web_search_requests ?? 0;

      // Immer vor dem Lesen von content pruefen: bei einer Verweigerung ist content leer
      // oder unvollstaendig, und ein blinder Zugriff auf content[0] wuerde brechen.
      if (response.stop_reason === "refusal") {
        return {
          ok: false,
          error: {
            reason: "refusal",
            detail: response.stop_details?.explanation ?? response.stop_details?.category ?? undefined,
          },
        };
      }

      // Die serverseitige Suchschleife hat ihr Iterationslimit erreicht. Assistenten-Zug
      // anhaengen und erneut senden; die API setzt selbstaendig fort.
      if (response.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: response.content });
        continue;
      }

      if (response.stop_reason === "max_tokens") {
        return { ok: false, error: { reason: "truncated" } };
      }

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return { ok: false, error: { reason: "invalid_output", detail: text.slice(0, 200) } };
      }

      if (!isValidMatchdayContext(parsed)) {
        return { ok: false, error: { reason: "invalid_output", detail: "Schema nicht erfuellt" } };
      }

      const sources = collectSources(response.content);
      return {
        ok: true,
        value: {
          contexts: matchToFixtures(parsed.matches, fixtures, sources),
          usage,
          costUsd: estimateCostUsd(profile, usage),
          model: profile.model,
        },
      };
    }

    return {
      ok: false,
      error: { reason: "api_error", detail: `Suchschleife nach ${MAX_CONTINUATIONS} Fortsetzungen offen` },
    };
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      return { ok: false, error: { reason: "api_error", detail: `${error.status}: ${error.message}` } };
    }
    return {
      ok: false,
      error: { reason: "api_error", detail: error instanceof Error ? error.message : "unbekannt" },
    };
  }
}

// Ordnet die Antworten den angefragten Partien zu.
//
// Der Prompt verlangt exakt unsere Teamnamen in exakt unserer Reihenfolge, aber darauf
// allein zu bauen waere leichtsinnig: ein verrutschter Eintrag wuerde die Ausfaelle der
// falschen Mannschaft zuordnen. Deshalb erst ueber die Namen, und nur wo das eindeutig
// scheitert, ueber die Position -- und ein Eintrag, der sich nicht zuordnen laesst, wird
// verworfen statt geraten.
function matchToFixtures(
  matches: LlmMatchContext[],
  fixtures: FixtureForPrompt[],
  sources: string[]
): Map<string, { context: LlmMatchContext; sources: string[] }> {
  const result = new Map<string, { context: LlmMatchContext; sources: string[] }>();
  const unclaimed = new Set(matches);

  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

  for (const fixture of fixtures) {
    const key = `${fixture.homeTeam}|${fixture.awayTeam}`;
    const byName = [...unclaimed].find(
      (m) =>
        normalize(m.homeTeam) === normalize(fixture.homeTeam) &&
        normalize(m.awayTeam) === normalize(fixture.awayTeam)
    );
    if (byName) {
      unclaimed.delete(byName);
      // Nur die Quellen behalten, die in den Faktoren dieser Partie auftauchen, plus die
      // Gesamtliste als Fallback -- eine Partie ohne Befund braucht keine Quellenliste.
      const own = byName.keyFactors.map((f) => f.source).filter((s) => s.startsWith("http"));
      result.set(key, { context: byName, sources: own.length > 0 ? [...new Set(own)] : sources });
    }
  }

  // Positionsbasierter Rueckfall nur fuer Partien, die per Name leer blieben, und nur
  // solange die Restmenge eindeutig ist.
  const missing = fixtures.filter((f) => !result.has(`${f.homeTeam}|${f.awayTeam}`));
  if (missing.length === 1 && unclaimed.size === 1) {
    const fixture = missing[0];
    const context = [...unclaimed][0];
    result.set(`${fixture.homeTeam}|${fixture.awayTeam}`, {
      // Teamnamen auf unsere Schreibweise ziehen, damit die UI konsistent bleibt.
      context: { ...context, homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam },
      sources,
    });
  }

  return result;
}

// Die tatsaechlich besuchten URLs stehen in den Suchergebnisbloecken -- verlaesslicher
// als das, was das Modell in den source-Feldern behauptet.
function collectSources(content: Anthropic.ContentBlock[]): string[] {
  const urls = new Set<string>();
  for (const block of content) {
    if (block.type !== "web_search_tool_result") continue;
    const results = block.content;
    // Bei einem Fehler ist content ein einzelnes Objekt, bei Erfolg eine Liste.
    if (!Array.isArray(results)) continue;
    for (const result of results) {
      if (result.type === "web_search_result" && result.url) urls.add(result.url);
    }
  }
  return [...urls];
}
