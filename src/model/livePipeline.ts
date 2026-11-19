// Welche Pipeline live rechnet, je Spieltag der laufenden Saison 2026/27.
//
//   Spieltag 1 bis 10   die eingefrorene Pipeline 2026, configHash 3cc0ddad
//   ab Spieltag 11      der Kandidat 2027/28 (candidate.ts), configHash 59ddd123
//
// Entschieden am 2026-11-19 (SAISONBETRIEB.md, "Vorgefallen: Umstellung ab Spieltag 11").
// Kein Fehler-Fix, sondern eine bewusste Ausnahme vom Freeze. Begruendet ist sie ohne einen
// Blick auf Ergebnisse dieser Saison: Bundesliga-Validation und vier weitere Ligen
// (MESSLAUF.md, Messplan 2 und "Mehrliga-Messbasis").
//
// Nach Spieltag geschaltet, nicht nach Datum oder Merge-Zeitpunkt. So rechnet jede Partie
// eines Spieltags mit derselben Pipeline, auch eine verlegte, und Spieltag 10, dessen
// Basismodell am 18.11. schon unter 3cc0ddad protokolliert wurde, bleibt ganz beim alten
// Stand -- egal wann diese Datei auf main landet.
//
// Was die Umstellung NICHT beruehrt:
//   - Messplan 2 vergleicht weiter Kandidat gegen die eingefrorene Pipeline 2026, beide
//     walk-forward nachgerechnet. Welche davon live lief, spielt dafuer keine Rolle.
//   - Der LLM-Layer bleibt eingefroren (Gain, Klammer, Prompt, Faktenzuordnung, Modell). Ab
//     Spieltag 11 legt er sich auf die Torerwartungen des Kandidaten.
//
// Alle Live-Einstiege holen ihre Pipeline hier: Seite (/api/predictions), Anpfiff-
// Schnappschuss, Vorwaerts-Log, npm run predict, Saisonsimulation. selfCheck prueft das.

import { loadAllMatches } from "../data/loadMatches";
import { FORWARD_SEASON } from "../eval/splits";
import type { OutcomeProbs } from "../eval/metrics";
import { CANDIDATE_2027, candidateModelOptions, outcomeBaseRate } from "./candidate";
import {
  DEFAULT_PIPELINE,
  FROZEN_CONFIG_HASH,
  KANDIDAT_CONFIG_HASH,
  KANDIDAT_PIPELINE,
  type PipelineConfig,
} from "./pipelineConfig";
import type { PipelineInput } from "./predictPipeline";
import { PRODUCTION_MODEL_OPTIONS, buildLeagueModel, type LeagueModel, type LeagueModelOptions } from "./teamStrength";

// Erster Spieltag, an dem der Kandidat live rechnet.
export const SWITCH_MATCHDAY = 11;

export type LiveVariant = "eingefroren-2026" | "kandidat-2027";

// Was predictPipeline je Variante zusaetzlich bekommt -- alles ausser Modell, Teams, Form und
// Spielkontext.
export type LivePipelineOptions = Pick<
  PipelineInput,
  "formApplication" | "formWeight" | "outcomeTemperature" | "matrixOptions" | "temperatureReference"
>;

export interface LivePipeline {
  variant: LiveVariant;
  // Fit-Einstellung fuer buildLeagueModel.
  modelOptions: LeagueModelOptions;
  // Beschreibung fuer den Hash, und der Hash, den sie treffen muss.
  config: PipelineConfig;
  frozenHash: string;
  options: LivePipelineOptions;
}

const FROZEN_2026: LivePipeline = {
  variant: "eingefroren-2026",
  modelOptions: PRODUCTION_MODEL_OPTIONS,
  config: DEFAULT_PIPELINE,
  frozenHash: FROZEN_CONFIG_HASH,
  // Leer: genau die Voreinstellungen von predictPipeline, Operation fuer Operation.
  options: {},
};

// Grundrate der Spiele VOR der laufenden Saison -- derselbe Bezug wie im Backtest
// (baseRatesOf), selfCheck prueft das. Einmal je Prozess berechnet.
let baseRate: OutcomeProbs | null = null;
function liveBaseRate(): OutcomeProbs {
  baseRate ??= outcomeBaseRate(loadAllMatches().filter((m) => m.season < FORWARD_SEASON));
  return baseRate;
}

let kandidat: LivePipeline | null = null;
function kandidat2027(): LivePipeline {
  kandidat ??= {
    variant: "kandidat-2027",
    modelOptions: candidateModelOptions(),
    config: KANDIDAT_PIPELINE,
    frozenHash: KANDIDAT_CONFIG_HASH,
    options: {
      formApplication: "ratio",
      formWeight: CANDIDATE_2027.formWeight,
      outcomeTemperature: CANDIDATE_2027.outcomeTemperature,
      matrixOptions: { rho: CANDIDATE_2027.rho },
      temperatureReference: liveBaseRate(),
    },
  };
  return kandidat;
}

export function livePipelineFor(matchday: number): LivePipeline {
  return matchday >= SWITCH_MATCHDAY ? kandidat2027() : FROZEN_2026;
}

// Der Fit, mit dem die Pipeline live rechnet: alle bisher gespielten Spiele. Der Modell-Cache
// in teamStrength.ts haelt beide Varianten nebeneinander, solange loadAllMatches() dieselbe
// Instanz liefert.
export function liveModelFor(pipeline: LivePipeline): LeagueModel {
  return buildLeagueModel(loadAllMatches(), pipeline.modelOptions);
}
