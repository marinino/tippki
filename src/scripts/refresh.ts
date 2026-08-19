// Holt Ergebnisse (OpenLigaDB) und xG (Understat) der laufenden Saison.
//
//   npm run refresh
//   npm run refresh -- --season=2026
//
// SAISONBETRIEB.md nennt diesen Aufruf seit jeher fuer nach dem Spielwochenende, es gab ihn
// aber nur als Knopf in der Oberflaeche. Solange alles von Hand lief, war das ein
// Schoenheitsfehler; fuer einen automatischen Lauf braucht es den Weg ueber die
// Kommandozeile, und derselbe Weg ist auch von Hand der verlaesslichere.
//
// Ruft dieselbe Funktion auf wie POST /api/refresh -- eine zweite Kopie der Logik waere
// genau die Sorte Abweichung, die spaeter niemand mehr findet.

import { deriveSeasonFromDate } from "../data/loadMatches";
import { refreshSeasonData } from "../data/refreshResults";

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

const season = flag("season") ?? deriveSeasonFromDate(new Date());

const summary = await refreshSeasonData(season);

console.log(
  `Saison ${summary.season}: ${summary.resultsCount} abgeschlossene Spiele, ` +
    `${summary.xgCount} davon mit xG.`
);

// oddsCount ist null, wenn football-data die Saison noch nicht fuehrt. Vor dem ersten
// Spieltag ist das der Normalfall und kein Fehler -- refreshSeasonData behandelt die
// Quoten bewusst als nicht-fatal, weil sie Massstab sind und nicht Betriebsgrundlage.
console.log(
  summary.oddsCount === null
    ? "Buchmacher-Schlussquoten: noch keine (football-data fuehrt die Saison nicht)."
    : `Buchmacher-Schlussquoten: ${summary.oddsCount} Spiele.`
);
