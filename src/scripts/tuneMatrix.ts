// Gemeinsame Suche ueber RHO und DRAW_BOOST -- mit Punkten als Zielgroesse.
//
//   npm run tune-matrix
//
// Warum nicht RPS wie sonst: der RPS bewertet ausschliesslich die drei aggregierten
// Ausgangswahrscheinlichkeiten. RHO und DRAW_BOOST verschieben aber Masse INNERHALB einer
// Tendenz -- von 1:0 nach 2:1, von 1:1 nach 0:0. Auf die Summe der Heimsieg-Zellen wirkt
// sich das kaum aus, auf den abgegebenen Tipp sehr wohl. Der RPS ist fuer diese beiden
// Parameter also bauartbedingt blind, und ihn hier zu benutzen war ein Fehler in der
// ersten Fassung von tuneModel.ts.
//
// Zielgroesse ist deshalb Punkte/Spiel, geprueft mit gepaartem Bootstrap. Zusaetzlich
// wird der RPS berichtet, damit sichtbar bleibt, ob eine Punkteverbesserung auf Kosten
// der Wahrscheinlichkeitsguete geht.

import { summarize } from "../eval/metrics";
import { pairedBootstrap } from "../eval/significance";
import { resolveScheme } from "../eval/scoringScheme";
import { parseSplit, seasonsFor, warnIfTestSplit, type SplitName } from "../eval/splits";
import { buildContexts, evaluateRun, toPerMatchMetrics, type RunSpec } from "../eval/backtestCore";
import { DEFAULT_DRAW_BOOST, DEFAULT_RHO } from "../model/scoreMatrix";

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

// Punkte sind roher als der RPS, deshalb eine Schwelle in Punkteeinheiten: 0.02
// Punkte/Spiel sind rund 6 Punkte pro Saison und damit gerade noch bemerkenswert.
const ACCEPT_THRESHOLD = 0.02;

const split: SplitName = flag("split") ? parseSplit(flag("split")) : "validation";
const scheme = resolveScheme(flag("scheme"));
warnIfTestSplit(split);

const seasons = seasonsFor(split);
const contexts = buildContexts(seasons, {});

const RHOS = [-0.25, -0.2, -0.15, -0.1, -0.05, 0, 0.05, 0.1];
const BOOSTS = [0.85, 0.9, 0.95, 1.0, 1.05, 1.1, 1.2];

const SETUPS: { label: string; base: RunSpec }[] = [
  { label: "nur Modell (Entwicklungsziel)", base: { name: "m", variant: "modelOnly", tipMode: "ev" } },
  {
    label: "volle Pipeline (Produktion)",
    base: { name: "m", variant: "blended", tipMode: "ev", useTotals: true },
  },
];

console.log(`Split "${split}", Schema "${scheme.label}", Zielgroesse: Punkte/Spiel`);
console.log(`Annahmeschwelle: Δ > ${ACCEPT_THRESHOLD} Punkte/Spiel bei p < 0.05\n`);

for (const setup of SETUPS) {
  console.log(`\n=== ${setup.label} ===`);

  const baselineEval = evaluateRun(contexts, setup.base, scheme);
  const baseline = summarize(baselineEval.map(toPerMatchMetrics));
  console.log(
    `Ausgang (RHO ${DEFAULT_RHO}, BOOST ${DEFAULT_DRAW_BOOST}): ` +
      `${baseline.pointsPerMatch.toFixed(3)} Pkt/Spiel, ` +
      `RPS ${baseline.rps.toFixed(4)}, Exakt ${(baseline.exactScoreRate * 100).toFixed(1)}%\n`
  );

  interface Cell {
    rho: number;
    boost: number;
    points: number;
    rps: number;
    exact: number;
    delta: number;
    pValue: number;
  }

  const cells: Cell[] = [];
  for (const rho of RHOS) {
    for (const drawBoost of BOOSTS) {
      const evaluations = evaluateRun(contexts, { ...setup.base, rho, drawBoost }, scheme);
      const summary = summarize(evaluations.map(toPerMatchMetrics));
      const diffs = evaluations.map((e, i) => e.points - baselineEval[i].points);
      const test = pairedBootstrap(diffs, { iterations: 3000 });
      cells.push({
        rho,
        boost: drawBoost,
        points: summary.pointsPerMatch,
        rps: summary.rps,
        exact: summary.exactScoreRate,
        delta: test.meanDiff,
        pValue: test.pValue,
      });
    }
  }

  // Punkte-Landschaft als Gitter -- so ist sofort sichtbar, ob es ein echtes Optimum gibt
  // oder ob die Flaeche flach ist und der beste Wert nur Rauschen abgreift.
  console.log("Punkte/Spiel      " + BOOSTS.map((b) => `B=${b.toFixed(2)}`).join("  "));
  for (const rho of RHOS) {
    const row = BOOSTS.map((b) => {
      const cell = cells.find((c) => c.rho === rho && c.boost === b)!;
      return cell.points.toFixed(3).padStart(7);
    }).join("  ");
    console.log(`  RHO ${rho >= 0 ? " " : ""}${rho.toFixed(2)}      ${row}`);
  }

  const best = [...cells].sort((a, b) => b.delta - a.delta)[0];
  console.log(
    `\nBestes Feld: RHO ${best.rho}, DRAW_BOOST ${best.boost} -> ` +
      `${best.points.toFixed(3)} Pkt/Spiel (Δ ${best.delta >= 0 ? "+" : ""}${best.delta.toFixed(4)}, ` +
      `p = ${best.pValue.toFixed(4)}), RPS ${best.rps.toFixed(4)}, ` +
      `Exakt ${(best.exact * 100).toFixed(1)}%`
  );
  console.log(
    best.delta > ACCEPT_THRESHOLD && best.pValue < 0.05
      ? `=> Ueberschreitet die Schwelle.`
      : `=> Unter der Schwelle (${ACCEPT_THRESHOLD} bei p < 0.05) -- nicht uebernehmen.`
  );

  const rpsChange = best.rps - baseline.rps;
  if (rpsChange > 0.001) {
    console.log(
      `   Achtung: der RPS verschlechtert sich um ${rpsChange.toFixed(4)}. Punkte gewinnen\n` +
        `   auf Kosten der Wahrscheinlichkeitsguete ist ein schlechter Tausch, wenn die\n` +
        `   Wahrscheinlichkeiten selbst angezeigt werden.`
    );
  }
}
