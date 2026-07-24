import { Match } from "../data/loadMatches";

export interface TeamStrength {
  attack: number;
  defense: number;
}

export interface LeagueModel {
  avgHomeGoals: number;
  avgAwayGoals: number;
  teams: Map<string, TeamStrength>;
  promotedTeamDefault: TeamStrength;
}

function leagueAverages(matches: Match[]): { avgHomeGoals: number; avgAwayGoals: number } {
  const numMatches = matches.length;
  const totalHomeGoals = matches.reduce((sum, m) => sum + m.homeGoals, 0);
  const totalAwayGoals = matches.reduce((sum, m) => sum + m.awayGoals, 0);
  return {
    avgHomeGoals: totalHomeGoals / numMatches,
    avgAwayGoals: totalAwayGoals / numMatches,
  };
}

const LEARNING_RATE = 0.0005;
const ITERATIONS = 500;

function fitPoissonModel(
  matches: Match[],
  avgHomeGoals: number,
  avgAwayGoals: number
): Map<string, TeamStrength> {
  const teamNames = [...new Set(matches.flatMap((m) => [m.homeTeam, m.awayTeam]))];

  const matchCounts = new Map(teamNames.map((t) => [t, 0]));
  for (const m of matches) {
    matchCounts.set(m.homeTeam, matchCounts.get(m.homeTeam)! + 1);
    matchCounts.set(m.awayTeam, matchCounts.get(m.awayTeam)! + 1);
  }
  const referenceTeam = [...matchCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];

  const attack = new Map(teamNames.map((t) => [t, 0]));
  const defense = new Map(teamNames.map((t) => [t, 0]));

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const attackGrad = new Map(teamNames.map((t) => [t, 0]));
    const defenseGrad = new Map(teamNames.map((t) => [t, 0]));

    for (const m of matches) {
      const lambdaHome =
        avgHomeGoals * Math.exp(attack.get(m.homeTeam)!) * Math.exp(defense.get(m.awayTeam)!);
      const lambdaAway =
        avgAwayGoals * Math.exp(attack.get(m.awayTeam)!) * Math.exp(defense.get(m.homeTeam)!);

      const homeResidual = m.homeGoals - lambdaHome;
      const awayResidual = m.awayGoals - lambdaAway;

      attackGrad.set(m.homeTeam, attackGrad.get(m.homeTeam)! + homeResidual);
      defenseGrad.set(m.awayTeam, defenseGrad.get(m.awayTeam)! + homeResidual);
      attackGrad.set(m.awayTeam, attackGrad.get(m.awayTeam)! + awayResidual);
      defenseGrad.set(m.homeTeam, defenseGrad.get(m.homeTeam)! + awayResidual);
    }

    for (const team of teamNames) {
      if (team !== referenceTeam) {
        attack.set(team, attack.get(team)! + LEARNING_RATE * attackGrad.get(team)!);
      }
      defense.set(team, defense.get(team)! + LEARNING_RATE * defenseGrad.get(team)!);
    }
  }

  const result = new Map<string, TeamStrength>();
  for (const team of teamNames) {
    result.set(team, { attack: attack.get(team)!, defense: defense.get(team)! });
  }
  return result;
}

export function poissonLogLikelihood(
  matches: Match[],
  teams: Map<string, TeamStrength>,
  avgHomeGoals: number,
  avgAwayGoals: number
): number {
  let logLikelihood = 0;
  for (const m of matches) {
    const home = teams.get(m.homeTeam)!;
    const away = teams.get(m.awayTeam)!;
    const lambdaHome = avgHomeGoals * Math.exp(home.attack) * Math.exp(away.defense);
    const lambdaAway = avgAwayGoals * Math.exp(away.attack) * Math.exp(home.defense);
    logLikelihood += -lambdaHome + m.homeGoals * Math.log(lambdaHome);
    logLikelihood += -lambdaAway + m.awayGoals * Math.log(lambdaAway);
  }
  return logLikelihood;
}

const WEAKEST_TEAM_COUNT = 4;

function computePromotedTeamDefault(teams: Map<string, TeamStrength>): TeamStrength {
  // Qualitaet = attack - defense: hoher Angriffswert und niedriger (guter) Abwehrwert sind gut.
  const weakest = [...teams.values()]
    .sort((a, b) => a.attack - a.defense - (b.attack - b.defense))
    .slice(0, WEAKEST_TEAM_COUNT);

  return {
    attack: weakest.reduce((sum, t) => sum + t.attack, 0) / weakest.length,
    defense: weakest.reduce((sum, t) => sum + t.defense, 0) / weakest.length,
  };
}

export function buildLeagueModel(matches: Match[]): LeagueModel {
  const { avgHomeGoals, avgAwayGoals } = leagueAverages(matches);
  const teams = fitPoissonModel(matches, avgHomeGoals, avgAwayGoals);
  const promotedTeamDefault = computePromotedTeamDefault(teams);

  return { avgHomeGoals, avgAwayGoals, teams, promotedTeamDefault };
}
