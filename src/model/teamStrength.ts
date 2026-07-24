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

function pickReferenceTeam(matches: Match[]): string {
  const matchCounts = new Map<string, number>();
  for (const m of matches) {
    matchCounts.set(m.homeTeam, (matchCounts.get(m.homeTeam) ?? 0) + 1);
    matchCounts.set(m.awayTeam, (matchCounts.get(m.awayTeam) ?? 0) + 1);
  }
  return [...matchCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function fitPoissonModel(
  matches: Match[],
  avgHomeGoals: number,
  avgAwayGoals: number,
  referenceTeam: string
): Map<string, TeamStrength> {
  const teamNames = [...new Set(matches.flatMap((m) => [m.homeTeam, m.awayTeam]))];

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

// Gewicht der letzten, vorletzten, ... Saison. Was fuer ein Team unbelegt bleibt
// (fehlende Saison oder das Reststueck bis 100%) faellt an promotedTeamDefault.
const SEASON_RECENCY_WEIGHTS = [0.6, 0.3, 0.05, 0.02, 0.02, 0.01];

function fitPerSeasonModels(
  matches: Match[],
  seasonsNewestFirst: string[],
  referenceTeam: string
): Map<string, Map<string, TeamStrength>> {
  const perSeason = new Map<string, Map<string, TeamStrength>>();

  for (const season of seasonsNewestFirst) {
    const seasonMatches = matches.filter((m) => m.season === season);
    const { avgHomeGoals, avgAwayGoals } = leagueAverages(seasonMatches);
    perSeason.set(season, fitPoissonModel(seasonMatches, avgHomeGoals, avgAwayGoals, referenceTeam));
  }

  return perSeason;
}

function applyRecencyWeighting(
  allTeamNames: string[],
  seasonsNewestFirst: string[],
  perSeasonTeams: Map<string, Map<string, TeamStrength>>,
  promotedTeamDefault: TeamStrength
): Map<string, TeamStrength> {
  const weighted = new Map<string, TeamStrength>();

  for (const team of allTeamNames) {
    let attack = 0;
    let defense = 0;
    let usedWeight = 0;

    seasonsNewestFirst.forEach((season, rank) => {
      const seasonStrength = perSeasonTeams.get(season)!.get(team);
      const weight = SEASON_RECENCY_WEIGHTS[rank] ?? 0;
      if (seasonStrength) {
        attack += weight * seasonStrength.attack;
        defense += weight * seasonStrength.defense;
        usedWeight += weight;
      }
    });

    const defaultWeight = 1 - usedWeight;
    attack += defaultWeight * promotedTeamDefault.attack;
    defense += defaultWeight * promotedTeamDefault.defense;

    weighted.set(team, { attack, defense });
  }

  return weighted;
}

export function buildLeagueModel(matches: Match[]): LeagueModel {
  const { avgHomeGoals, avgAwayGoals } = leagueAverages(matches);
  const referenceTeam = pickReferenceTeam(matches);

  const fullFitTeams = fitPoissonModel(matches, avgHomeGoals, avgAwayGoals, referenceTeam);
  const promotedTeamDefault = computePromotedTeamDefault(fullFitTeams);

  const seasonsNewestFirst = [...new Set(matches.map((m) => m.season))].sort().reverse();
  const perSeasonTeams = fitPerSeasonModels(matches, seasonsNewestFirst, referenceTeam);
  const teams = applyRecencyWeighting(
    [...fullFitTeams.keys()],
    seasonsNewestFirst,
    perSeasonTeams,
    promotedTeamDefault
  );

  return { avgHomeGoals, avgAwayGoals, teams, promotedTeamDefault };
}
