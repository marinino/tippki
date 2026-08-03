// Formkurve fuer den Saison-Simulator (Frontend-Tab "Simulieren"): dort werden Ergebnisse fuer
// noch nicht gespielte Spiele frei erfunden/eingetragen, es existieren also keine echten
// Understat-xG-Daten dazu (siehe xgForm.ts fuer die echte, xG-basierte Variante). Als Ersatz
// dient hier die Tordifferenz der eingetragenen Ergebnisse -- gleiches Fensterprinzip wie
// XG_FORM_WINDOW, nur mit Toren statt xG als Eingabe.
import { XG_FORM_WINDOW } from "./xgForm";

export interface SimpleResult {
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
}

export function computeSimulatedForm(team: string, resultsSoFar: SimpleResult[]): number {
  const teamMatches = resultsSoFar.filter((r) => r.homeTeam === team || r.awayTeam === team);
  const recent = teamMatches.slice(-XG_FORM_WINDOW);
  if (recent.length === 0) return 0;

  const totalDiff = recent.reduce((sum, m) => {
    const isHome = m.homeTeam === team;
    const goalsFor = isHome ? m.homeGoals : m.awayGoals;
    const goalsAgainst = isHome ? m.awayGoals : m.homeGoals;
    return sum + (goalsFor - goalsAgainst);
  }, 0);

  return totalDiff / recent.length;
}
