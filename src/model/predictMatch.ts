import { LeagueModel } from "./teamStrength";
import { XG_FORM_WEIGHT } from "./xgForm";

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

function poissonProbability(lambda: number, k: number): number {
  return (Math.exp(-lambda) * lambda ** k) / factorial(k);
}

function factorial(n: number): number {
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

const MAX_GOALS = 10;

// Dixon-Coles-Korrektur: in echten Daten kommen 0:0, 1:0, 0:1 und 1:1 etwas anders
// vor, als die (vereinfachende) Annahme unabhaengiger Heim-/Auswaertstore vorhersagt.
const RHO = -0.15;

function dixonColesTau(h: number, a: number, lambdaHome: number, lambdaAway: number): number {
  if (h === 0 && a === 0) return 1 - lambdaHome * lambdaAway * RHO;
  if (h === 0 && a === 1) return 1 + lambdaHome * RHO;
  if (h === 1 && a === 0) return 1 + lambdaAway * RHO;
  if (h === 1 && a === 1) return 1 - RHO;
  return 1;
}

// Genereller Bonus fuer JEDES Unentschieden (0:0, 1:1, 2:2, ...), nicht nur die
// von dixonColesTau abgedeckten Faelle. 1 = kein Effekt.
const DRAW_BOOST = 1.2;

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
export function predictFromLambdas(
  expectedHomeGoals: number,
  expectedAwayGoals: number,
  homeIsEstimated = false,
  awayIsEstimated = false
): MatchPrediction {
  const scoreProbabilities = new Map<string, number>();
  let homeWinProb = 0;
  let drawProb = 0;
  let awayWinProb = 0;
  let mostLikelyScore = "0:0";
  let mostLikelyProb = -1;

  let totalProb = 0;
  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const prob =
        poissonProbability(expectedHomeGoals, h) *
        poissonProbability(expectedAwayGoals, a) *
        dixonColesTau(h, a, expectedHomeGoals, expectedAwayGoals) *
        (h === a ? DRAW_BOOST : 1);
      scoreProbabilities.set(`${h}:${a}`, prob);
      totalProb += prob;
    }
  }

  for (const [score, prob] of scoreProbabilities) {
    const normalizedProb = prob / totalProb;
    scoreProbabilities.set(score, normalizedProb);

    const [h, a] = score.split(":").map(Number);
    if (h > a) homeWinProb += normalizedProb;
    else if (h === a) drawProb += normalizedProb;
    else awayWinProb += normalizedProb;

    if (normalizedProb > mostLikelyProb) {
      mostLikelyProb = normalizedProb;
      mostLikelyScore = score;
    }
  }

  return {
    expectedHomeGoals,
    expectedAwayGoals,
    scoreProbabilities,
    homeWinProb,
    drawProb,
    awayWinProb,
    mostLikelyScore,
    homeIsEstimated,
    awayIsEstimated,
  };
}
