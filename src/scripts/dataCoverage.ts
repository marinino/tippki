// Abdeckung der Marktspalten je Saison.
//
//   npm run coverage
//
// Die CSVs kommen in zwei Spaltenschemata (Betbrain-Aggregate bis 2018/19, moderne Namen
// ab 2019/20). Dieses Skript zeigt, ob die Namensketten in loadMatches.ts in jeder Saison
// greifen -- und faellt sofort auf, wenn ein Datenrefresh Spalten weggeschrieben hat.

import { loadAllMatches } from "../data/loadMatches";

const matches = loadAllMatches();

interface Coverage {
  n: number;
  x2: number;
  ou: number;
  ah: number;
  sot: number;
}

const bySeason = new Map<string, Coverage>();

for (const m of matches) {
  const e = bySeason.get(m.season) ?? { n: 0, x2: 0, ou: 0, ah: 0, sot: 0 };
  e.n++;
  if (m.oddsHome && m.oddsDraw && m.oddsAway) e.x2++;
  if (m.oddsOver25 && m.oddsUnder25) e.ou++;
  if (m.ahLine !== undefined && m.ahOddsHome && m.ahOddsAway) e.ah++;
  if (m.shotsOnTargetHome !== undefined) e.sot++;
  bySeason.set(m.season, e);
}

function bar(part: number, total: number): string {
  const pct = total === 0 ? 0 : (part / total) * 100;
  const mark = pct === 100 ? "✓" : pct === 0 ? "✗" : "·";
  return `${mark} ${String(part).padStart(3)}/${String(total).padEnd(3)}`;
}

console.log("Saison    1X2          O/U 2.5      Asian Hcp    SoT");
for (const season of [...bySeason.keys()].sort()) {
  const e = bySeason.get(season)!;
  console.log(
    `${season}    ${bar(e.x2, e.n)}  ${bar(e.ou, e.n)}  ${bar(e.ah, e.n)}  ${bar(e.sot, e.n)}`
  );
}

// Fuer die Marktbedingungen zaehlt, ob die Asian-Handicap-Linie eine saubere Partition
// erlaubt. Nur Halblinien tun das -- Viertellinien verteilen den Einsatz auf zwei
// Nachbarlinien und sind keine Zweiwegwette.
const lineCounts = new Map<number, number>();
for (const m of matches) {
  if (m.ahLine === undefined) continue;
  lineCounts.set(m.ahLine, (lineCounts.get(m.ahLine) ?? 0) + 1);
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
  `Nutzbar fuer eine saubere Tordifferenz-Bedingung: ${((half / withLine) * 100).toFixed(1)}%`
);
