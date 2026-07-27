import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { OUR_NAME_TO_UNDERSTAT } from "../data/understatTeamNames";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface XgMatch {
  season: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
  homeXG: number;
  awayXG: number;
}

// Anzahl der letzten Spiele fuer die xG-Formkurve. Kurzfristiges xG (statt Tore) ist ein
// deutlich rauschaermeres Signal fuer die aktuelle Form als Tordifferenz -- bestaetigt durch
// Backtests hier im Projekt und durch eine Bundesliga-Studie (Wilkens 2026), die denselben
// Ansatz (rollierendes xG der letzten 3 Spiele) nutzt.
export const XG_FORM_WINDOW = 3;

// Wie stark die xG-Formkurve die erwarteten Tore beeinflusst (multiplikativ via exp(beta * form)).
export const XG_FORM_WEIGHT = 0.2;

let cachedMatches: XgMatch[] | null = null;

function loadXgMatches(): XgMatch[] {
  if (!cachedMatches) {
    const raw = readFileSync(join(__dirname, "..", "..", "data", "xg_bundesliga.json"), "utf-8");
    const matches: XgMatch[] = JSON.parse(raw);
    cachedMatches = [...matches].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }
  return cachedMatches;
}

// Durchschnittliche xG-Differenz (erzielt minus zugelassen) der letzten `n` Spiele eines Teams
// vor `beforeDate`, saisonuebergreifend. 0, wenn kein Teamname-Mapping oder keine Historie existiert.
export function computeXgForm(ourTeamName: string, beforeDate: Date, n: number = XG_FORM_WINDOW): number {
  const understatName = OUR_NAME_TO_UNDERSTAT[ourTeamName];
  if (!understatName) return 0;

  const matches = loadXgMatches();
  const teamMatches = matches.filter(
    (m) => (m.homeTeam === understatName || m.awayTeam === understatName) && new Date(m.date) < beforeDate
  );
  const recent = teamMatches.slice(-n);
  if (recent.length === 0) return 0;

  const totalXgDiff = recent.reduce((sum, m) => {
    const isHome = m.homeTeam === understatName;
    const xgFor = isHome ? m.homeXG : m.awayXG;
    const xgAgainst = isHome ? m.awayXG : m.homeXG;
    return sum + (xgFor - xgAgainst);
  }, 0);

  return totalXgDiff / recent.length;
}
