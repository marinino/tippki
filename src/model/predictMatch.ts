import { LeagueModel } from "./teamStrength";
import { XG_FORM_WEIGHT } from "./xgForm";
import {
  argmaxCell,
  buildDixonColesMatrix,
  outcomeMasses,
  toScoreMap,
  type MatrixOptions,
} from "./scoreMatrix";

export interface MatchPrediction {
  expectedHomeGoals: number;
  expectedAwayGoals: number;
  scoreProbabilities: Map<string, number>;
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  mostLikelyScore: string;
  homeIsEstimated: boolean;
  awayIsEstimated: boolean;
}

// Basis-Torerwartungen ohne Formeffekt. Getrennt herausgezogen, damit der Backtest sie
// einmal pro Spiel berechnen und danach beliebig viele Formgewichte darauf durchprobieren
// kann, ohne das Modell neu zu fitten.
export function baseLambdas(
  model: LeagueModel,
  homeTeam: string,
  awayTeam: string
): { lambdaHome: number; lambdaAway: number; homeIsEstimated: boolean; awayIsEstimated: boolean } {
  const homeIsEstimated = !model.teams.has(homeTeam);
  const awayIsEstimated = !model.teams.has(awayTeam);
  const home = model.teams.get(homeTeam) ?? model.promotedTeamDefault;
  const away = model.teams.get(awayTeam) ?? model.promotedTeamDefault;

  return {
    lambdaHome: model.avgHomeGoals * Math.exp(home.attack) * Math.exp(away.defense),
    lambdaAway: model.avgAwayGoals * Math.exp(away.attack) * Math.exp(home.defense),
    homeIsEstimated,
    awayIsEstimated,
  };
}

export function predictMatch(
  model: LeagueModel,
  homeTeam: string,
  awayTeam: string,
  // xG-Formkurve (durchschnittliche xG-Differenz der letzten Spiele) je Team, optional.
  // 0 = kein Formeffekt, z.B. wenn kein Teamname-Mapping oder keine Historie existiert.
  homeForm: number = 0,
  awayForm: number = 0
): MatchPrediction {
  const base = baseLambdas(model, homeTeam, awayTeam);

  return predictFromLambdas(
    base.lambdaHome * Math.exp(XG_FORM_WEIGHT * homeForm),
    base.lambdaAway * Math.exp(XG_FORM_WEIGHT * awayForm),
    base.homeIsEstimated,
    base.awayIsEstimated
  );
}

// Der eigentliche Vorhersageschritt: Score-Matrix aus zwei Torerwartungen. Nimmt die
// Lambdas direkt entgegen, damit Aufrufer sie vorher beliebig anpassen koennen (Form,
// Marktquoten, LLM-Korrektur), ohne diese Logik zu duplizieren.
// Bis hierher stand die Matrixberechnung ein zweites Mal in dieser Datei, mit eigenen
// Kopien von MAX_GOALS, RHO und DRAW_BOOST. Solange beide Kopien dieselben Werte hatten,
// fiel das nicht auf -- beim ersten Aendern von DRAW_BOOST liefen sie sofort auseinander
// und lieferten fuer dasselbe Spiel verschiedene Wahrscheinlichkeiten. Jetzt gibt es nur
// noch scoreMatrix.ts als Quelle.
export function predictFromLambdas(
  expectedHomeGoals: number,
  expectedAwayGoals: number,
  homeIsEstimated = false,
  awayIsEstimated = false,
  options?: MatrixOptions
): MatchPrediction {
  const matrix = buildDixonColesMatrix(expectedHomeGoals, expectedAwayGoals, options);
  const masses = outcomeMasses(matrix);

  return {
    expectedHomeGoals,
    expectedAwayGoals,
    scoreProbabilities: toScoreMap(matrix),
    homeWinProb: masses.homeWinProb,
    drawProb: masses.drawProb,
    awayWinProb: masses.awayWinProb,
    mostLikelyScore: argmaxCell(matrix),
    homeIsEstimated,
    awayIsEstimated,
  };
}
