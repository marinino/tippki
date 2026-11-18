// Passt der xG-Feed zur Ergebnis-CSV? (VERBESSERUNGEN.md, Punkt 2)
//
// Die Formkurve (src/model/xgForm.ts) nimmt die Fensterlaenge n aus der Ergebnis-CSV und
// zaehlt dann n Eintraege im xG-Feed rueckwaerts -- ueber die Saisongrenze hinweg. Fehlt
// einem Team ein Spiel dieser Saison im Feed, entsteht kein Loch im Fenster, sondern ein
// Spiel der VORSAISON rutscht hinein. Das ist genau der Zustand, gegen den das Hochfahren
// des Fensters am Saisonstart gebaut wurde.
//
// Die Formkurve selbst ist eingefroren; repariert wird deshalb nicht dort, sondern an der
// Quelle: dieser Zustand darf gar nicht erst committet werden. refreshSeasonData bricht ab,
// wenn er nach dem Abruf besteht, forwardLog warnt, falls er trotzdem im Repo steht
// (manueller Commit), und selfCheck prueft den echten Datenstand.
//
// Pure Funktionen, damit sie ohne Netz und ohne Dateien pruefbar sind.

import { OUR_NAME_TO_UNDERSTAT } from "./understatTeamNames";

interface SeasonMatch {
  season: string;
  homeTeam: string;
  awayTeam: string;
}

export interface XgCoverageGap {
  // Unser Name (Ergebnis-CSV) und der Name im xG-Feed.
  team: string;
  xgName: string;
  results: number;
  xg: number;
}

function countByTeam(matches: SeasonMatch[], season: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of matches) {
    if (m.season !== season) continue;
    counts.set(m.homeTeam, (counts.get(m.homeTeam) ?? 0) + 1);
    counts.set(m.awayTeam, (counts.get(m.awayTeam) ?? 0) + 1);
  }
  return counts;
}

// Teams, die in dieser Saison mehr Ergebnisse als xG-Spiele haben. Nur diese Richtung: hat
// der Feed MEHR Spiele als die CSV (die CSV haengt hinterher), bleibt n klein und das
// Fenster in der Saison -- harmlos fuer die Formkurve.
//
// Teams ohne Zuordnung zu einem Understat-Namen fehlen hier bewusst. Ihre Form ist 0, nicht
// verschoben, und die Zuordnung prueft selfCheck ("xG-Form == Referenzimplementierung").
export function xgCoverageGaps(
  season: string,
  results: SeasonMatch[],
  xg: SeasonMatch[]
): XgCoverageGap[] {
  const resultCounts = countByTeam(results, season);
  const xgCounts = countByTeam(xg, season);
  const gaps: XgCoverageGap[] = [];
  for (const [team, count] of resultCounts) {
    const xgName = OUR_NAME_TO_UNDERSTAT[team];
    if (!xgName) continue;
    const xgCount = xgCounts.get(xgName) ?? 0;
    if (xgCount < count) gaps.push({ team, xgName, results: count, xg: xgCount });
  }
  return gaps.sort((a, b) => a.team.localeCompare(b.team));
}

// Paarungen, die in einer Saison mehr als einmal im Feed stehen. In der Bundesliga gibt es
// jede Paarung mit fester Heimmannschaft genau einmal je Saison -- ein zweiter Eintrag ist
// also immer ein Fehler, typischerweise ein FotMob-Lueckenfueller, dessen Anstosszeit nicht
// zum Understat-Eintrag passte (mergeFallbackXg vergleicht ueber Datum und Teams). Er
// zaehlte im Formfenster doppelt.
export function xgDuplicatePairings(season: string, xg: SeasonMatch[]): string[] {
  const seen = new Map<string, number>();
  for (const m of xg) {
    if (m.season !== season) continue;
    const key = `${m.homeTeam} - ${m.awayTeam}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen].filter(([, n]) => n > 1).map(([key]) => key).sort();
}

export function describeXgGaps(gaps: XgCoverageGap[]): string {
  return gaps.map((g) => `${g.team}: ${g.results} Ergebnisse, ${g.xg} mit xG`).join("; ");
}
