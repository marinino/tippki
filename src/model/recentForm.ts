import { Match, parseMatchDate } from "../data/loadMatches";

// Anzahl der letzten Spiele, die in die Formkurve einfliessen.
export const FORM_WINDOW = 10;

// Wie stark die Formkurve die erwarteten Tore beeinflusst (multiplikativ via exp(beta * form)).
export const FORM_WEIGHT = 0.08;

// Durchschnittliche Tordifferenz der letzten `n` Spiele eines Teams vor `beforeDate`,
// saisonuebergreifend chronologisch sortiert. Nutzt nur echte Vergangenheit (kein Data-Leakage).
export function computeRecentForm(
  matchesSortedByDate: Match[],
  team: string,
  beforeDate: Date,
  n: number = FORM_WINDOW
): number {
  const teamMatches = matchesSortedByDate.filter(
    (m) => (m.homeTeam === team || m.awayTeam === team) && parseMatchDate(m.date) < beforeDate
  );
  const recent = teamMatches.slice(-n);
  if (recent.length === 0) return 0;

  const totalGoalDiff = recent.reduce((sum, m) => {
    const goalsFor = m.homeTeam === team ? m.homeGoals : m.awayGoals;
    const goalsAgainst = m.homeTeam === team ? m.awayGoals : m.homeGoals;
    return sum + (goalsFor - goalsAgainst);
  }, 0);

  return totalGoalDiff / recent.length;
}

export function sortByDate(matches: Match[]): Match[] {
  return [...matches].sort((a, b) => parseMatchDate(a.date).getTime() - parseMatchDate(b.date).getTime());
}
