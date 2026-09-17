// Holt die Buchmacher-Schlussquoten der laufenden Saison nach.
//
//   npm run refresh-market
//   npm run refresh-market -- --season=2026
//
// Nach dem Spieltag laufen lassen, vor "npm run forward-eval". Die Quoten kommen bei
// football-data mit ein bis drei Tagen Verzug -- wer direkt nach Abpfiff abruft, bekommt die
// Spiele des Spieltags noch nicht.

import { deriveSeasonFromDate } from "../data/loadMatches";
import { refreshMarketOdds } from "../data/refreshMarketOdds";

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

const season = flag("season") ?? deriveSeasonFromDate(new Date());

const summary = await refreshMarketOdds(season);

// Nicht erreichbar ist eine Stoerung, aber keine, fuer die der Lauf rot werden soll: sonst
// bleiben Spielplan und Ergebnisse uncommittet und die Pruefungen dahinter laufen nicht. Die
// ::warning::-Zeile macht sie in GitHub Actions trotzdem als Annotation am Lauf sichtbar.
if (!summary.reachable) {
  console.log(
    `football-data.co.uk nicht erreichbar (${summary.error}). Nichts geaendert --\n` +
      `der naechste Lauf holt die Schlussquoten nach.`
  );
  if (process.env.GITHUB_ACTIONS) {
    console.log(`::warning::football-data.co.uk nicht erreichbar (${summary.error}), Schlussquoten nicht aktualisiert.`);
  }
  process.exit(0);
}

if (!summary.published) {
  console.log(
    `football-data fuehrt die Saison ${season} noch nicht.\n` +
      `Vor dem ersten Spieltag ist das der Normalfall. Nichts geaendert.`
  );
  process.exit(0);
}

console.log(
  `Saison ${season}: ${summary.fetchedRows} Spiele von football-data, ` +
    `${summary.updatedRows} bestehende Zeilen ergaenzt, ${summary.addedRows} neu angelegt.`
);
console.log(
  `Mit Schlussquote: Pinnacle ${summary.withPinnacleClose}, Marktmittel ${summary.withAverageClose}.`
);

if (summary.withPinnacleClose < summary.withAverageClose * 0.8) {
  console.log(
    `\nHinweis: Pinnacle deckt deutlich weniger Spiele ab als das Marktmittel. Seit dem\n` +
      `10.09.2026 ist "marketAverageClose" die Voreinstellung, es ist also nichts zu tun --\n` +
      `wer ausdruecklich "--benchmark=pinnacleClose" setzt, misst auf entsprechend wenigen\n` +
      `Spielen. Dann aber in forward-eval UND im Backtest, sonst meinen die beiden Zahlen\n` +
      `verschiedene Gegner.`
  );
}
