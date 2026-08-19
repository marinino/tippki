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

if (!summary.published) {
  console.log(
    `football-data fuehrt die Saison ${season} noch nicht (oder war nicht erreichbar).\n` +
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
    `\nHinweis: Pinnacle deckt deutlich weniger Spiele ab als das Marktmittel. Der Vergleich\n` +
      `laeuft mit "--benchmark=pinnacleClose" dann auf entsprechend wenigen Spielen. Wer die\n` +
      `volle Fallzahl braucht, nimmt ausdruecklich "--benchmark=marketAverageClose" -- in\n` +
      `forward-eval UND im Backtest, sonst meinen die beiden Zahlen verschiedene Gegner.`
  );
}
