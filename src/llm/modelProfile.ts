// Was das gewaehlte Modell an API-Oberflaeche unterstuetzt.
//
// Die Unterschiede sind klein, aber hart: `effort` wird von Haiku 4.5 mit einem Fehler
// quittiert, und die Websuche mit dynamischer Filterung (web_search_20260209) gibt es
// erst ab Opus 4.6 / Sonnet 4.6 -- aeltere Modelle brauchen die Basisvariante. Diese
// Tabelle sorgt dafuer, dass ein Modellwechsel eine Konstante bleibt und nicht eine
// Fehlersuche.

export type SupportedModel = "claude-haiku-4-5" | "claude-sonnet-5" | "claude-opus-5";

export interface ModelProfile {
  model: SupportedModel;
  // Dynamische Filterung gibt es erst ab Opus 4.6 / Sonnet 4.6. Bei aelteren Modellen
  // landen die Rohtreffer im Kontext -- mehr Eingabe-Token, aber es funktioniert.
  webSearchType: "web_search_20260209" | "web_search_20250305";
  // Haiku 4.5 lehnt output_config.effort ab.
  supportsEffort: boolean;
  // Listenpreise je Million Token, fuer die Kostenschaetzung.
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

const PROFILES: Record<SupportedModel, ModelProfile> = {
  // Voreinstellung. Fuer strukturierte Extraktion aus Suchergebnissen voellig
  // ausreichend -- das ist Lesen und Einordnen, keine tiefe Schlussfolgerung.
  "claude-haiku-4-5": {
    model: "claude-haiku-4-5",
    webSearchType: "web_search_20250305",
    supportsEffort: false,
    inputUsdPerMillion: 1,
    outputUsdPerMillion: 5,
  },
  // Mittelweg, falls die Urteilsqualitaet nicht reicht.
  //
  // Gemessen am 2026-09-01 gegen Haiku, gleiche Last: Sonnets dynamische Filterung
  // halbiert die Token je Suche (~9.000 statt ~18.900) und kostet doppelt so viel je
  // Token. Das hebt sich auf -- beide liegen bei rund 0,03 USD je Suche. Der Wechsel
  // hierher kauft also Urteilsqualitaet, keine Ersparnis.
  "claude-sonnet-5": {
    model: "claude-sonnet-5",
    webSearchType: "web_search_20260209",
    supportsEffort: true,
    inputUsdPerMillion: 2,
    outputUsdPerMillion: 10,
  },
  "claude-opus-5": {
    model: "claude-opus-5",
    webSearchType: "web_search_20260209",
    supportsEffort: true,
    inputUsdPerMillion: 5,
    outputUsdPerMillion: 25,
  },
};

// Hier umstellen, sonst nirgends. Ueber die Umgebungsvariable LLM_MODEL laesst sich das
// ohne Codeaenderung ueberschreiben.
export const DEFAULT_MODEL: SupportedModel = "claude-haiku-4-5";

export function resolveModelProfile(): ModelProfile {
  const fromEnv = process.env.LLM_MODEL as SupportedModel | undefined;
  if (fromEnv && PROFILES[fromEnv]) return PROFILES[fromEnv];
  return PROFILES[DEFAULT_MODEL];
}

// Websuchgebuehr: 10 USD je 1000 Anfragen, unabhaengig vom Modell.
//
// ACHTUNG, das ist nur ein Drittel der wahren Kosten einer Suche. Die Suchtreffer landen im
// Kontext, und in der serverseitigen Suchschleife wird bei jeder Iteration der ganze
// angesammelte Kontext neu abgerechnet -- wer frueh sucht, zahlt seine Treffer so oft, wie
// danach noch gesucht wird. Gemessen (2026-09-01, beide Modelle): rund 0,03 USD je Suche
// all-in, davon 0,01 Gebuehr und ~0,02 Token.
//
// Praktische Folge: die einzige Stellschraube, die die Kosten wirklich bewegt, ist die
// ZAHL der Suchen. Nicht das Modell, nicht der Prompt, nicht die Buendelung der Ausgabe.
export const SEARCH_USD_PER_REQUEST = 10 / 1000;

export function estimateCostUsd(
  profile: ModelProfile,
  usage: { inputTokens: number; outputTokens: number; webSearches: number }
): number {
  return (
    (usage.inputTokens * profile.inputUsdPerMillion) / 1_000_000 +
    (usage.outputTokens * profile.outputUsdPerMillion) / 1_000_000 +
    usage.webSearches * SEARCH_USD_PER_REQUEST
  );
}
