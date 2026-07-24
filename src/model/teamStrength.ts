import { Match } from "../data/loadMatches";

export interface TeamStrength {
  attackHome: number;
  defenseHome: number;
  attackAway: number;
  defenseAway: number;
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

function computeTeamStrength(
  matches: Match[],
  team: string,
  avgHomeGoals: number,
  avgAwayGoals: number
): TeamStrength {
  const homeMatches = matches.filter((m) => m.homeTeam === team);
  const awayMatches = matches.filter((m) => m.awayTeam === team);

  const goalsScoredHome = homeMatches.reduce((sum, m) => sum + m.homeGoals, 0);
  const goalsConcededHome = homeMatches.reduce((sum, m) => sum + m.awayGoals, 0);
  const goalsScoredAway = awayMatches.reduce((sum, m) => sum + m.awayGoals, 0);
  const goalsConcededAway = awayMatches.reduce((sum, m) => sum + m.homeGoals, 0);

  return {
    attackHome: goalsScoredHome / homeMatches.length / avgHomeGoals,
    defenseHome: goalsConcededHome / homeMatches.length / avgAwayGoals,
    attackAway: goalsScoredAway / awayMatches.length / avgAwayGoals,
    defenseAway: goalsConcededAway / awayMatches.length / avgHomeGoals,
  };
}

function findPromotedTeamDebuts(matches: Match[]): { team: string; season: string }[] {
  const teamsBySeason = new Map<string, Set<string>>();
  for (const m of matches) {
    if (!teamsBySeason.has(m.season)) teamsBySeason.set(m.season, new Set());
    teamsBySeason.get(m.season)!.add(m.homeTeam);
    teamsBySeason.get(m.season)!.add(m.awayTeam);
  }

  const seasons = [...teamsBySeason.keys()].sort();
  const debuts: { team: string; season: string }[] = [];

  for (let i = 1; i < seasons.length; i++) {
    const previousTeams = teamsBySeason.get(seasons[i - 1])!;
    const currentTeams = teamsBySeason.get(seasons[i])!;
    for (const team of currentTeams) {
      if (!previousTeams.has(team)) {
        debuts.push({ team, season: seasons[i] });
      }
    }
  }

  return debuts;
}

function computePromotedTeamDefault(matches: Match[]): TeamStrength {
  const debuts = findPromotedTeamDebuts(matches);

  const profiles = debuts.map(({ team, season }) => {
    const seasonMatches = matches.filter((m) => m.season === season);
    const { avgHomeGoals, avgAwayGoals } = leagueAverages(seasonMatches);
    return computeTeamStrength(seasonMatches, team, avgHomeGoals, avgAwayGoals);
  });

  const average = (key: keyof TeamStrength) =>
    profiles.reduce((sum, p) => sum + p[key], 0) / profiles.length;

  return {
    attackHome: average("attackHome"),
    defenseHome: average("defenseHome"),
    attackAway: average("attackAway"),
    defenseAway: average("defenseAway"),
  };
}

export function buildLeagueModel(matches: Match[]): LeagueModel {
  const { avgHomeGoals, avgAwayGoals } = leagueAverages(matches);

  const teamNames = new Set<string>();
  for (const m of matches) {
    teamNames.add(m.homeTeam);
    teamNames.add(m.awayTeam);
  }

  const teams = new Map<string, TeamStrength>();
  for (const team of teamNames) {
    teams.set(team, computeTeamStrength(matches, team, avgHomeGoals, avgAwayGoals));
  }

  const promotedTeamDefault = computePromotedTeamDefault(matches);

  return { avgHomeGoals, avgAwayGoals, teams, promotedTeamDefault };
}
