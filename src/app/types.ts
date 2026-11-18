// Die Formen, die die API-Routen an die UI liefern.

import type { PriceSheet } from "../model/priceSheet";
import type { MetricSummary } from "../eval/metrics";
import type { VariantName } from "../eval/backtestCore";
import type { BenchmarkSource } from "../eval/benchmarkOdds";
import type { DisplayNumbers } from "../data/displayPredictions";

interface PredictionHead {
  homeTeam: string;
  awayTeam: string;
  homeLogo: string | null;
  awayLogo: string | null;
  date: string;
}

// Woher die Zahlen einer Partie kommen (src/data/kickoffSnapshots.ts).
//   live          -- noch nicht eingefroren, bei jedem Aufruf neu gerechnet
//   anpfiff       -- kurz vor Anpfiff eingefroren (`at`), nie wieder veraendert
//   vorwaertslog  -- angepfiffen ohne Schnappschuss: die protokollierte Vorhersage (`at`),
//                    geschrieben vor dem ersten Anpfiff des Spieltags, ohne Matrix
export type PredictionSource =
  | { kind: "live" }
  | { kind: "anpfiff"; at: string }
  | { kind: "vorwaertslog"; at: string };

// Die Felder der Zahlen (Torerwartung, 1X2, Preisblatt, Spielkontext) sind in
// DisplayNumbers beschrieben.
export type PricedPrediction = PredictionHead & DisplayNumbers & { source: PredictionSource };

// Angepfiffen, aber weder eingefroren noch protokolliert: keine Zahlen. Nachgerechnet wird
// nach Anpfiff nie.
export type MissingPrediction = PredictionHead & { source: { kind: "fehlt" } };

export type Prediction = PricedPrediction | MissingPrediction;

export function hasNumbers(p: Prediction): p is PricedPrediction {
  return p.source.kind !== "fehlt";
}

export interface PredictionsResponse {
  predictions: Prediction[];
  matchday: number | null;
  nextMatchday: number | null;
  availableMatchdays: number[];
  llmFetchedAt: string | null;
  llmModel: string | null;
  // Was der Recherchelauf dieses Spieltags tatsaechlich getan hat. null bei Spieltagen
  // ohne Kontext -- und bei Staenden von vor dem 01.09.2026, die noch keine Suchzahl
  // fuehren.
  //
  // Steht hier, weil die Karte den Ausfall von Spieltag 1 nicht zeigen konnte: dort stand
  // neunmal "recherchiert, ohne Befund", und das war nach der Statuslogik sogar richtig --
  // ein Kontext lag ja vor. Dass die Recherche keine einzige Suche abgesetzt hatte, war
  // aus der Anzeige nicht zu erkennen.
  llmRun: {
    webSearches: number;
    researchChars: number;
    searchErrors: string[];
    costUsd: number;
  } | null;
  // Gehostete Instanz: kein beschreibbares data/, deshalb keine Aktualisierungsknoepfe.
  readOnly: boolean;
  // ... es sei denn, jemand ist als Admin angemeldet. Dann stossen sie den Workflow an.
  admin: boolean;
}

export interface SeasonBacktest {
  season: string;
  trainMatchCount: number;
  evaluated: number;
  tendencyAccuracy: number;
  rps: number;
  logLoss: number;
}

export interface CalibrationView {
  bins: { from: number; to: number; n: number; meanPredicted: number; observed: number }[];
  expectedCalibrationError: number;
  totalPoints: number;
}

export interface BacktestResult {
  split: string;
  variant: VariantName;
  benchmark: BenchmarkSource;
  benchmarkLabel: string;
  perSeason: SeasonBacktest[];
  totalMatches: number;
  totalEvaluated: number;
  overall: MetricSummary;
  baselines: Record<VariantName, MetricSummary>;
  // Zwei Reliability-Diagramme nebeneinander: das Modell und die Messlatte. Eine einzelne
  // Kalibrierungskurve sagt wenig -- interessant ist, wo sie von der des Marktes abweicht.
  calibration: CalibrationView;
  benchmarkCalibration: CalibrationView;
}

export interface TableEntry {
  position: number;
  team: string;
  logo: string | null;
  matches: number;
  won: number;
  draw: number;
  lost: number;
  goals: number;
  opponentGoals: number;
  goalDiff: number;
  points: number;
  // Letzte fuenf Ergebnisse, chronologisch (aeltestes zuerst).
  form: ("S" | "U" | "N")[];
}

export interface TableResponse {
  season: string;
  table: TableEntry[];
}

export interface SimPrediction {
  homeTeam: string;
  awayTeam: string;
  homeLogo: string | null;
  awayLogo: string | null;
  date: string;
  expectedHomeGoals: number;
  expectedAwayGoals: number;
  scoreGrid: number[][];
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  mostLikelyScore: string;
  prices: PriceSheet;
  homeIsEstimated: boolean;
  awayIsEstimated: boolean;
}

export interface SimResponse {
  matchday: number;
  totalMatchdays: number;
  predictions: SimPrediction[];
  table: TableEntry[];
}

export interface SimResult {
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
}

// "data" erscheint nur fuer einen angemeldeten Admin -- der Reiter wird gar nicht erst
// gezeigt, und der Endpunkt dahinter prueft ohnehin selbst.
export type Tab = "predictions" | "table" | "backtest" | "simulate" | "data";
