// Die Formen, die die API-Routen an die UI liefern. Vorher lagen sie als 130 Zeilen
// Interface-Block am Kopf von page.tsx und waren damit nur dort verwendbar.

export interface BookmakerOdds {
  bookmaker: string;
  oddsHome: number;
  oddsDraw: number;
  oddsAway: number;
}

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
  // Der abzugebende Tipp: maximiert den Punkte-Erwartungswert, nicht die
  // Einzelwahrscheinlichkeit. Weicht deshalb bewusst oft vom wahrscheinlichsten
  // Ergebnis (argmaxTip) ab.
  tip: string;
  expectedPoints: number;
  runnerUpTip: string;
  runnerUpExpectedPoints: number;
  argmaxTip: string;
  mostLikelyScore: string;
  homeIsEstimated: boolean;
  awayIsEstimated: boolean;
  oddsBlended: boolean;
  // Welche Marktinformationen in die Ergebnismatrix eingeflossen sind, z.B.
  // ["1X2", "Totals (10 Linien)", "Spread (4 Linien)"].
  marketConstraints: string[];
  bookmakerOdds: BookmakerOdds[] | null;
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
  scheme: string;
  schemeLabel: string;
  oddsFetchedAt: string | null;
  llmFetchedAt: string | null;
  llmModel: string | null;
}

export interface SeasonBacktest {
  season: string;
  trainMatchCount: number;
  evaluated: number;
  tendencyAccuracy: number;
  exactScoreAccuracy: number;
  pointsPerMatch: number;
  rps: number;
}

export interface BacktestResult {
  perSeason: SeasonBacktest[];
  totalEvaluated: number;
  totalTendencyAccuracy: number;
  totalExactScoreAccuracy: number;
  schemeLabel: string;
  overall: {
    pointsPerMatch: number;
    expectedPointsPerMatch: number | null;
    rps: number;
    logLoss: number;
  };
  baselines: Record<string, { tendencyAccuracy: number; rps: number }>;
  calibration: {
    bins: { from: number; to: number; n: number; meanPredicted: number; observed: number }[];
    expectedCalibrationError: number;
    totalPoints: number;
  };
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
  // Wahrscheinlichkeit je Ergebnis, grid[Heimtore][Auswaertstore], 0..5 Tore je Seite.
  scoreGrid: number[][];
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  tip: string;
  expectedPoints: number;
  runnerUpTip: string;
  runnerUpExpectedPoints: number;
  argmaxTip: string;
  mostLikelyScore: string;
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
