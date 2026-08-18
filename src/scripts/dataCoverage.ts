// Abdeckung der Referenzquoten je Saison.
//
//   npm run coverage
//
// Die Quoten sind in diesem Projekt ausschliesslich Messlatte, nie Eingabe. Genau deshalb
// zaehlt ihre Abdeckung: fehlt in einer Saison die Referenz, faellt diese Saison aus dem
// gepaarten Vergleich heraus und die Gesamtzahl beruht still auf weniger Spielen, als sie
// zu behaupten scheint.
//
// Die CSVs kommen in zwei Spaltenschemata (Betbrain-Aggregate bis 2018/19, moderne Namen
// ab 2019/20). Dieses Skript zeigt, ob die Namensketten in loadMatches.ts in jeder Saison
// greifen -- und faellt sofort auf, wenn ein Datenrefresh Spalten weggeschrieben hat.

import { loadAllMatches } from "../data/loadMatches";
import { benchmarkQuote, BENCHMARK_LABELS, type BenchmarkSource } from "../eval/benchmarkOdds";

const matches = loadAllMatches();

interface Coverage {
  n: number;
  x2: number;
  ou: number;
  ahHalf: number;
  sot: number;
}

const SOURCES: BenchmarkSource[] = ["pinnacleClose", "marketAverageClose", "marketAverageOpen"];

for (const source of SOURCES) {
  const bySeason = new Map<string, Coverage>();

  for (const m of matches) {
    const e = bySeason.get(m.season) ?? { n: 0, x2: 0, ou: 0, ahHalf: 0, sot: 0 };
    e.n++;
    const q = benchmarkQuote(m, source);
    if (q) e.x2++;
    if (q?.totalsOverProb !== null && q?.totalsOverProb !== undefined) e.ou++;
    if (q?.handicap) e.ahHalf++;
    if (m.shotsOnTargetHome !== undefined) e.sot++;
    bySeason.set(m.season, e);
  }

  console.log(`\n=== ${BENCHMARK_LABELS[source]} ===`);
  console.log("Saison    1X2          O/U 2.5      AH Halblinie   SoT");
  for (const season of [...bySeason.keys()].sort()) {
    const e = bySeason.get(season)!;
    console.log(
      `${season}    ${bar(e.x2, e.n)}  ${bar(e.ou, e.n)}  ${bar(e.ahHalf, e.n)}    ${bar(e.sot, e.n)}`
    );
  }
}

function bar(part: number, total: number): string {
  const pct = total === 0 ? 0 : (part / total) * 100;
  const mark = pct === 100 ? "✓" : pct === 0 ? "✗" : "·";
  return `${mark} ${String(part).padStart(3)}/${String(total).padEnd(3)}`;
}

// Nur Halblinien erlauben eine saubere Zweiwegwette. Viertellinien verteilen den Einsatz
// auf zwei Nachbarlinien, ganze Linien kennen ein Push -- beides laesst sich nicht in eine
// zweiwertige Wahrscheinlichkeit uebersetzen, ohne zu schummeln.
const lineCounts = new Map<number, number>();
for (const m of matches) {
  const line = m.closeAhLine ?? m.openAhLine;
  if (line === undefined) continue;
  lineCounts.set(line, (lineCounts.get(line) ?? 0) + 1);
}

let half = 0;
let quarter = 0;
let whole = 0;
for (const [line, count] of lineCounts) {
  const frac = Math.abs(line % 1);
  if (frac === 0.5) half += count;
  else if (frac === 0.25 || frac === 0.75) quarter += count;
  else whole += count;
}

const withLine = half + quarter + whole;
console.log(
  `\nAsian-Handicap-Linien: ${half} Halblinien (nutzbar), ${quarter} Viertellinien, ` +
    `${whole} ganze Linien (Push moeglich) -- von ${withLine} mit Linie`
);
console.log(
  `Nutzbar als Tordifferenz-Messlatte: ${((half / withLine) * 100).toFixed(1)}% -- der ` +
    `Handicap-Vergleich laeuft also auf deutlich weniger Spielen als der 1X2-Vergleich.`
);
