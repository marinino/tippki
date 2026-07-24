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

  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const prob =
        poissonProbability(expectedHomeGoals, h) * poissonProbability(expectedAwayGoals, a);
      scoreProbabilities.set(`${h}:${a}`, prob);

      if (h > a) homeWinProb += prob;
      else if (h === a) drawProb += prob;
      else awayWinProb += prob;

      if (prob > mostLikelyProb) {
        mostLikelyProb = prob;
        mostLikelyScore = `${h}:${a}`;
      }
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
