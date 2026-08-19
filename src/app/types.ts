// Die Formen, die die API-Routen an die UI liefern.

import type { LlmStatus } from "../llm/llmCache";
import type { PriceSheet } from "../model/priceSheet";
import type { MetricSummary } from "../eval/metrics";
import type { VariantName } from "../eval/backtestCore";
import type { BenchmarkSource } from "../eval/benchmarkOdds";

export interface Prediction {
  homeTeam: string;
  awayTeam: string;
  homeLogo: string | null;
  awayLogo: string | null;
  date: string;
  expectedHomeGoals: number;
  expectedAwayGoals: number;
  // Wahrscheinlichkeit je Ergebnis, grid[Heimtore][Auswaertstore], 0..5 Tore je Seite.
  scoreGrid: number[][];
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  mostLikelyScore: string;
  // Faire Quoten ueber alle Maerkte -- das eigentliche Produkt.
  prices: PriceSheet;
  homeIsEstimated: boolean;
  awayIsEstimated: boolean;
  // Recherchierter Spielkontext (Ausfaelle, Belastung, Motivation).
  llmApplied: boolean;
  // Ob und wie die Recherche fuer genau diese Partie gelaufen ist -- llmApplied allein
  // konnte "nie gefragt" nicht von "gefragt, nichts gefunden" unterscheiden.
  llmStatus: LlmStatus;
  llmFailureReason: string | null;
  llmFetchedAt: string | null;
  llmHomeAdjustmentPct: number | null;
  llmAwayAdjustmentPct: number | null;
  llmFactors: string[];
  llmSummary: string | null;
  llmSources: string[];
}

export interface PredictionsResponse {
  predictions: Prediction[];
  matchday: number | null;
  nextMatchday: number | null;
  availableMatchdays: number[];
  llmFetchedAt: string | null;
  llmModel: string | null;
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
