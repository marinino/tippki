import { LeagueModel } from "./teamStrength";

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

export function predictMatch(
  model: LeagueModel,
  homeTeam: string,
  awayTeam: string
): MatchPrediction {
  const homeIsEstimated = !model.teams.has(homeTeam);
  const awayIsEstimated = !model.teams.has(awayTeam);
  const home = model.teams.get(homeTeam) ?? model.promotedTeamDefault;
  const away = model.teams.get(awayTeam) ?? model.promotedTeamDefault;

  const expectedHomeGoals = model.avgHomeGoals * Math.exp(home.attack) * Math.exp(away.defense);
  const expectedAwayGoals = model.avgAwayGoals * Math.exp(away.attack) * Math.exp(home.defense);

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
