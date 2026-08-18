// Die Formen, die die API-Routen an die UI liefern.

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
  llmBlocked: boolean;
  llmShrinkFactor: number | null;
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

export type Tab = "predictions" | "table" | "backtest" | "simulate";
