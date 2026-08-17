// Gepaarter Vergleich zweier Vorhersage-Laeufe auf identischen Spielen.
//
//   npm run compare
//   npm run compare -- --split=validation
//   npm run compare -- --scheme=kicktipp321
//
// Warum gepaart: bei n=2448 ist der Standardfehler der Trefferquote 1.01 Prozentpunkte.
// Zwei Varianten, die sich nur auf 200 Spielen unterscheiden, sind ungepaart grundsaetzlich
// nicht auseinanderzuhalten -- gepaart dagegen sehr wohl, weil die uebrigen 2248 Spiele
// exakt herausfallen statt Rauschen beizusteuern.

import { formatSummary } from "../eval/metrics";
import { formatBootstrap, formatMcNemar } from "../eval/significance";
import { resolveScheme } from "../eval/scoringScheme";
import { parseSplit, seasonsFor, warnIfTestSplit, type SplitName } from "../eval/splits";
import { buildContexts, compareRuns, type RunSpec } from "../eval/backtestCore";

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

const split: SplitName = flag("split") ? parseSplit(flag("split")) : "all";
const scheme = resolveScheme(flag("scheme"));

warnIfTestSplit(split);

const seasons = seasonsFor(split);
const contexts = buildContexts(seasons);

console.log(`Split "${split}" (${seasons.join(", ")}), Punkteschema "${scheme.label}"\n`);

// Drei Stufen, damit sich der Gewinn sauber zuordnen laesst statt als ein Blockeffekt
// dazustehen.
const IST: RunSpec = { name: "ist (argmax, ohne Markt)", variant: "blended", tipMode: "argmaxLegacy" };
const MARKT: RunSpec = { name: "argmax auf Marktmatrix", variant: "blended", tipMode: "argmaxReweighted" };
const EV: RunSpec = { name: "EV-Tipp auf Marktmatrix", variant: "blended", tipMode: "ev" };
const EV_OHNE_MARKT: RunSpec = { name: "EV-Tipp ohne Markt", variant: "modelOnly", tipMode: "ev" };
const EV_TOTALS: RunSpec = {
  name: "EV + 1X2 + Over/Under",
  variant: "blended",
  tipMode: "ev",
  useTotals: true,
};

const steps: [RunSpec, RunSpec, string][] = [
  [EV_OHNE_MARKT, IST, "Nur EV-Auswahl (ohne Marktinfo im Tipp)"],
  [MARKT, IST, "Nur Marktinfo im Tipp (weiter argmax)"],
  [EV, IST, "Phase 1 gesamt: EV-Tipp auf 1X2-korrigierter Matrix"],
  [EV_TOTALS, EV, "Phase 2: Torsummen-Bedingung obendrauf"],
  [EV_TOTALS, IST, "Alles zusammen gegen den Ausgangszustand"],
];

for (const [a, b, label] of steps) {
  const c = compareRuns(contexts, a, b, scheme);

  console.log(`=== ${label} ===`);
  console.log(`  A = ${a.name}`);
  console.log(`  B = ${b.name}`);
  console.log(`  ${formatSummary("A", c.summaryA)}`);
  console.log(`  ${formatSummary("B", c.summaryB)}`);
  console.log(
    `  Tipp weicht ab auf ${c.tipsDiffering} von ${c.n} Spielen ` +
      `(${((c.tipsDiffering / c.n) * 100).toFixed(1)}%)`
  );
  console.log(`  ${formatBootstrap("Punkte/Spiel (Bootstrap)", c.points)}`);
  console.log(`  ${formatMcNemar("Tendenz (McNemar)", c.tendency)}`);

  const positive = c.perSeasonPointsDiff.filter((s) => s.diff > 0).length;
  const perSeason = c.perSeasonPointsDiff
    .map((s) => `${s.season}: ${s.diff >= 0 ? "+" : ""}${s.diff}`)
    .join("  ");
  console.log(`  Punkte je Saison (${positive}/${c.perSeasonPointsDiff.length} positiv): ${perSeason}`);
  console.log(
    `  Hochgerechnet auf eine Saison (306 Spiele): ` +
      `${c.points.meanDiff >= 0 ? "+" : ""}${(c.points.meanDiff * 306).toFixed(1)} Punkte\n`
  );
}

// Orakel: unter 1/1/1 zaehlt nur die Tendenz, dort muss der EV-Tipp die Tendenz des
// Argmax der aggregierten Wahrscheinlichkeiten reproduzieren -- also darf die
// Tendenz-Trefferquote sich nicht unterscheiden.
const tendencyOnly = resolveScheme("tendencyOnly");
const oracle = compareRuns(contexts, EV, MARKT, tendencyOnly);
const drift = Math.abs(oracle.summaryA.tendencyAccuracy - oracle.summaryB.tendencyAccuracy);
console.log(
  `Orakel (Schema "nur Tendenz"): Tendenz EV ${(oracle.summaryA.tendencyAccuracy * 100).toFixed(2)}% ` +
    `vs argmax ${(oracle.summaryB.tendencyAccuracy * 100).toFixed(2)}% -- ` +
    `Abweichung ${(drift * 100).toFixed(4)}pp`
);
