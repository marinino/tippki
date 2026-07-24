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
}

export function buildLeagueModel(matches: Match[]): LeagueModel {
  const numMatches = matches.length;
  const totalHomeGoals = matches.reduce((sum, m) => sum + m.homeGoals, 0);
  const totalAwayGoals = matches.reduce((sum, m) => sum + m.awayGoals, 0);
  const avgHomeGoals = totalHomeGoals / numMatches;
  const avgAwayGoals = totalAwayGoals / numMatches;

  const teamNames = new Set<string>();
  for (const m of matches) {
    teamNames.add(m.homeTeam);
    teamNames.add(m.awayTeam);
  }

  const teams = new Map<string, TeamStrength>();

  for (const team of teamNames) {
    const homeMatches = matches.filter((m) => m.homeTeam === team);
    const awayMatches = matches.filter((m) => m.awayTeam === team);

    const goalsScoredHome = homeMatches.reduce((sum, m) => sum + m.homeGoals, 0);
    const goalsConcededHome = homeMatches.reduce((sum, m) => sum + m.awayGoals, 0);
    const goalsScoredAway = awayMatches.reduce((sum, m) => sum + m.awayGoals, 0);
    const goalsConcededAway = awayMatches.reduce((sum, m) => sum + m.homeGoals, 0);

    teams.set(team, {
      attackHome: goalsScoredHome / homeMatches.length / avgHomeGoals,
      defenseHome: goalsConcededHome / homeMatches.length / avgAwayGoals,
      attackAway: goalsScoredAway / awayMatches.length / avgAwayGoals,
      defenseAway: goalsConcededAway / awayMatches.length / avgHomeGoals,
    });
  }

  return { avgHomeGoals, avgAwayGoals, teams };
}
