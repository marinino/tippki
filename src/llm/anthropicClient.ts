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
// ZWEISTUFIG, seit 2026-09-01. Vorher lief Recherche und Schema-Extraktion fuer alle neun
// Partien in einem Aufruf; das ist an der Zuordnung gescheitert und hat den Layer eine
// ganze Runde lang still inert gemacht (Begruendung und Messwerte in matchContext.ts).
// Jetzt: ein Rechercheaufruf fuer den Spieltag, danach Extraktionsaufrufe je drei Partien.
//
// KOSTEN, gemessen statt geschaetzt (2026-09-01, Haiku und Sonnet 5, je auf echter Last):
// rund 0,03 USD je Websuche -- 0,01 Gebuehr plus ~0,02 Token. Die Token dominieren, weil in
// der serverseitigen Suchschleife bei jeder Iteration der ganze angesammelte Kontext neu
// bezahlt wird; die frueh gefundenen Treffer zahlt man so oft, wie danach noch gesucht
// wird. Die Modellwahl ist dafuer fast gleichgueltig: Sonnets dynamische Filterung
// halbiert die Token je Suche und kostet doppelt so viel je Token. Der einzige echte Hebel
// ist die ZAHL der Suchen -- daher ein Rechercheaufruf statt drei suchende Bloecke, und
// daher die auf Ausfaelle verengte Rechercheanweisung.

import Anthropic from "@anthropic-ai/sdk";
import {
  EXTRACTION_SYSTEM_PROMPT,
  MATCHDAY_CONTEXT_SCHEMA,
  RESEARCH_SYSTEM_PROMPT,
  buildExtractionPrompt,
  buildResearchPrompt,
  extractionBlocks,
  isGiveUpSignature,
  isValidMatchdayContext,
  type FixtureForPrompt,
  type LlmMatchContext,
} from "./matchContext";
import { estimateCostUsd, resolveModelProfile, type ModelProfile } from "./modelProfile";

// Der Recherchebericht ist Fliesstext ueber achtzehn Mannschaften.
const RESEARCH_MAX_TOKENS = 16000;

// Die Extraktion sieht drei Partien und gibt drei Schema-Eintraege zurueck.
const EXTRACTION_MAX_TOKENS = 8000;

// Suchbudget fuer den EINEN Rechercheaufruf.
//
// Gemessen: drei Partien allein brauchten acht Suchen. Achtzehn Mannschaften ueber
// Sammelquellen (Verletztenlisten) liegen bei etwa zwoelf. Vierzehn laesst Luft, ohne dass
// der Betrag ins Geld laeuft -- bei ~0,03 USD je Suche sind das rund 0,42 USD.
//
// Nach unten ist das keine harmlose Schraube: mit einem sichtbar zu knappen Budget bricht
// das Modell die Recherche ab und meldet fuer JEDE Partie "nichts gefunden", statt den
// Fehlschlag zu melden. Mit max_uses=1 auf neun Partien reproduzierbar nachgestellt --
// fuenf parallel abgesetzte Suchen, eine durchgelaufen, vier max_uses_exceeded, danach
// neunmal derselbe Nullsatz. Genau dieser Ausfall hat Spieltag 1 gekostet.
const MAX_SEARCHES = 14;

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
  // Fehlercodes der Websuche, z.B. max_uses_exceeded. Frueher wurden diese Bloecke beim
  // Quellensammeln stillschweigend uebersprungen -- ein erschoepftes Suchbudget sah damit
  // exakt aus wie ein ruhiger Spieltag.
  searchErrors: string[];
  // Laenge des Rechercheberichts. Ein sehr kurzer Bericht bei vielen Suchen heisst, dass
  // die Recherche zwar lief, aber nichts hergab -- ein anderer Zustand als "nie gesucht".
  researchChars: number;
  // Partien, deren Extraktionsblock gescheitert ist, mit dem echten Grund.
  blockFailures: Record<string, string>;
}

export interface LlmFailure {
  reason:
    | "no_api_key"
    | "refusal"
    | "invalid_output"
    | "api_error"
    | "truncated"
    // Die Recherchestufe hat keine einzige Websuche abgesetzt. Ohne Suche gibt es keinen
    // Bericht, und ohne Bericht waere jede Extraktion daraus ein neunfaches
    // "nichts gefunden" -- ununterscheidbar von einem echten Nullspieltag. Lieber gar
    // kein Cache als einer voller erfundener Nullbefunde.
    | "no_search"
    // Suchbudget erschoepft und ueber den ganzen Spieltag kein einziger Faktor: die
    // Signatur des Aufgebens, siehe isGiveUpSignature. Nicht dasselbe wie no_search --
    // hier laufen durchaus Suchen, nur zu wenige.
    | "budget_exhausted";
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
  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0, webSearches: 0 };

  try {
    const research = await runResearch(client, profile, fixtures, matchday, usage);
    if (!research.ok) return research;

    // Der Riegel. Null Suchen heisst: die Stufe, die als einzige neue Information
    // beschaffen kann, hat nicht stattgefunden. Alles danach waere Wahrsagerei mit
    // Schema.
    if (usage.webSearches === 0) {
      return {
        ok: false,
        error: {
          reason: "no_search",
          detail: `${research.value.searchErrors.length} Suchfehler: ${
            [...new Set(research.value.searchErrors)].join(", ") || "keine"
          }`,
        },
      };
    }

    const contexts = new Map<string, { context: LlmMatchContext; sources: string[] }>();
    const blockFailures: Record<string, string> = {};

    for (const block of extractionBlocks(fixtures)) {
      const extracted = await runExtraction(client, profile, block, research.value.text, usage);
      // Ein gescheiterter Block darf die uebrigen nicht mitreissen: zwei Drittel
      // Spielkontext sind besser als keiner. Der Grund wird aber mitgenommen, statt die
      // Partien nur als "keine zuordenbare Antwort" enden zu lassen -- eine abgeschnittene
      // Extraktion ist etwas anderes als eine verrutschte Zuordnung.
      if (!extracted.ok) {
        const reason = extracted.error.detail
          ? `Extraktion ${extracted.error.reason}: ${extracted.error.detail}`
          : `Extraktion ${extracted.error.reason}`;
        for (const f of block) blockFailures[`${f.homeTeam}|${f.awayTeam}`] = reason;
        continue;
      }
      for (const [key, value] of matchToFixtures(
        extracted.value,
        block,
        research.value.sources
      )) {
        contexts.set(key, value);
      }
    }

    // Zweiter Riegel, und der wichtigere: erschoepftes Budget plus null Faktoren ueber den
    // ganzen Spieltag ist die Signatur des Aufgebens. Der Null-Suchen-Riegel oben greift
    // dafuer nicht, weil in diesem Zustand durchaus einzelne Suchen durchlaufen.
    if (
      isGiveUpSignature(
        research.value.searchErrors,
        [...contexts.values()].map((c) => c.context.keyFactors.length)
      )
    ) {
      return {
        ok: false,
        error: {
          reason: "budget_exhausted",
          detail:
            `${usage.webSearches} Suchen gelaufen, danach max_uses_exceeded, und ueber alle ` +
            `${contexts.size} Partien kein einziger Faktor`,
        },
      };
    }

    return {
      ok: true,
      value: {
        contexts,
        usage,
        costUsd: estimateCostUsd(profile, usage),
        model: profile.model,
        searchErrors: research.value.searchErrors,
        researchChars: research.value.text.length,
        blockFailures,
      },
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

interface ResearchResult {
  text: string;
  sources: string[];
  searchErrors: string[];
}

// Stufe 1: suchen und einen Fliesstextbericht schreiben. Kein Schema -- das Modell soll
// nicht gleichzeitig recherchieren und ein Formular ausfuellen.
async function runResearch(
  client: Anthropic,
  profile: ModelProfile,
  fixtures: FixtureForPrompt[],
  matchday: number,
  usage: LlmUsage
): Promise<{ ok: true; value: ResearchResult } | { ok: false; error: LlmFailure }> {
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: buildResearchPrompt(fixtures, matchday) },
  ];

  // Ueber ALLE Runden gesammelt, nicht nur aus der letzten Antwort. Vorher stand hier ein
  // collectSources(response.content) hinter der Schleife -- damit gingen saemtliche
  // Quell-URLs verloren, sobald die Suchschleife auch nur einmal pausiert hatte, denn die
  // letzte Antwort enthaelt nur noch den Text.
  const sources = new Set<string>();
  const searchErrors: string[] = [];
  let text = "";

  for (let attempt = 0; attempt <= MAX_CONTINUATIONS; attempt++) {
    const response = await client.messages.create({
      model: profile.model,
      max_tokens: RESEARCH_MAX_TOKENS,
      system: RESEARCH_SYSTEM_PROMPT,
      messages,
      tools: [{ type: profile.webSearchType, name: "web_search", max_uses: MAX_SEARCHES }],
      ...(profile.supportsEffort ? { output_config: { effort: "medium" as const } } : {}),
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

    harvest(response.content, sources, searchErrors);
    text += textOf(response.content);

    // Die serverseitige Suchschleife hat ihr Iterationslimit erreicht. Assistenten-Zug
    // anhaengen und erneut senden; die API setzt selbstaendig fort.
    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }

    // Ein abgeschnittener Bericht ist unvollstaendig, aber nicht wertlos -- die zuerst
    // genannten Mannschaften stehen vollstaendig darin. Abbrechen wuerde auch die
    // bezahlten Suchen wegwerfen.
    if (response.stop_reason === "max_tokens") searchErrors.push("bericht_abgeschnitten");

    return { ok: true, value: { text, sources: [...sources], searchErrors } };
  }

  return {
    ok: false,
    error: { reason: "api_error", detail: `Suchschleife nach ${MAX_CONTINUATIONS} Fortsetzungen offen` },
  };
}

// Stufe 2: aus dem Bericht drei Partien fuellen. Keine Werkzeuge, kein Netz -- damit auch
// keine Suchergebnisse im Kontext und entsprechend fast keine Kosten.
async function runExtraction(
  client: Anthropic,
  profile: ModelProfile,
  block: FixtureForPrompt[],
  research: string,
  usage: LlmUsage
): Promise<{ ok: true; value: LlmMatchContext[] } | { ok: false; error: LlmFailure }> {
  const response = await client.messages.create({
    model: profile.model,
    max_tokens: EXTRACTION_MAX_TOKENS,
    system: EXTRACTION_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildExtractionPrompt(block, research) }],
    output_config: {
      // effort wird von Haiku 4.5 mit einem Fehler quittiert, deshalb nur setzen,
      // wo das Modell es kennt.
      ...(profile.supportsEffort ? { effort: "medium" as const } : {}),
      format: { type: "json_schema", schema: MATCHDAY_CONTEXT_SCHEMA },
    },
  });

  usage.inputTokens += response.usage.input_tokens;
  usage.outputTokens += response.usage.output_tokens;

  if (response.stop_reason === "refusal") {
    return {
      ok: false,
      error: {
        reason: "refusal",
        detail: response.stop_details?.explanation ?? response.stop_details?.category ?? undefined,
      },
    };
  }
  if (response.stop_reason === "max_tokens") {
    return { ok: false, error: { reason: "truncated" } };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(textOf(response.content));
  } catch {
    return { ok: false, error: { reason: "invalid_output", detail: "kein JSON" } };
  }

  if (!isValidMatchdayContext(parsed)) {
    return { ok: false, error: { reason: "invalid_output", detail: "Schema nicht erfuellt" } };
  }

  return { ok: true, value: parsed.matches };
}

function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

// Die tatsaechlich besuchten URLs stehen in den Suchergebnisbloecken -- verlaesslicher
// als das, was das Modell in den source-Feldern behauptet. Fehlerbloecke werden nicht mehr
// verschluckt, sondern mit ihrem Code gemeldet: bei Erfolg ist content eine Liste, im
// Fehlerfall ein einzelnes Objekt.
function harvest(
  content: Anthropic.ContentBlock[],
  sources: Set<string>,
  searchErrors: string[]
): void {
  for (const block of content) {
    if (block.type !== "web_search_tool_result") continue;
    const results = block.content;
    if (Array.isArray(results)) {
      for (const result of results) {
        if (result.type === "web_search_result" && result.url) sources.add(result.url);
      }
    } else {
      searchErrors.push(results?.error_code ?? "unbekannt");
    }
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
