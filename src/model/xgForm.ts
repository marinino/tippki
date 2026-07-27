import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { OUR_NAME_TO_UNDERSTAT } from "../data/understatTeamNames";
import { loadAllMatches, parseMatchDate, deriveSeasonFromDate } from "../data/loadMatches";

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

let cachedXgMatches: XgMatch[] | null = null;

function loadXgMatches(): XgMatch[] {
  if (!cachedXgMatches) {
    const raw = readFileSync(join(__dirname, "..", "..", "data", "xg_bundesliga.json"), "utf-8");
    const matches: XgMatch[] = JSON.parse(raw);
    cachedXgMatches = [...matches].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }
  return cachedXgMatches;
}

let cachedOwnMatches: ReturnType<typeof loadAllMatches> | null = null;

function loadOwnMatches() {
  if (!cachedOwnMatches) cachedOwnMatches = loadAllMatches();
  return cachedOwnMatches;
}

// Muss nach einem Datenupdate (siehe refreshResults.ts) aufgerufen werden, sonst wuerden
// die alten, im Prozess zwischengespeicherten Match-/xG-Daten weiterverwendet.
export function clearXgFormCache(): void {
  cachedXgMatches = null;
  cachedOwnMatches = null;
}

// Zaehlt, wie viele Ligaspiele ein Team in der zu `beforeDate` gehoerenden Saison bereits
// bestritten hat. Damit laesst sich das Formfenster am Saisonstart hochfahren, statt sofort
// mit Spielen aus der Vorsaison zu rechnen (an Spieltag 1 ist die Formkurve sonst veraltet).
function gamesPlayedThisSeason(ourTeamName: string, beforeDate: Date): number {
  const season = deriveSeasonFromDate(beforeDate);
  return loadOwnMatches().filter(
    (m) =>
      m.season === season &&
      (m.homeTeam === ourTeamName || m.awayTeam === ourTeamName) &&
      parseMatchDate(m.date) < beforeDate
  ).length;
}

// Durchschnittliche xG-Differenz (erzielt minus zugelassen) der letzten Spiele eines Teams vor
// `beforeDate`. Das Fenster faehrt am Saisonstart hoch (0 an Spieltag 1, 1 an Spieltag 2, ...,
// ab Spieltag XG_FORM_WINDOW+1 das volle Fenster), damit keine veralteten Vorsaison-Spiele in
// die Form der neuen Saison einfliessen. 0, wenn kein Teamname-Mapping oder keine Historie existiert.
export function computeXgForm(ourTeamName: string, beforeDate: Date): number {
  const understatName = OUR_NAME_TO_UNDERSTAT[ourTeamName];
  if (!understatName) return 0;

  const n = Math.min(gamesPlayedThisSeason(ourTeamName, beforeDate), XG_FORM_WINDOW);
  if (n === 0) return 0;

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
