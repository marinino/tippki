// Wo genau steht das Modell gegen den Markt?
//
//   npm run market-gap
//
// Der Gesamtabstand (RPS 0.2042 gegen 0.1978) ist ein Mittelwert und verdeckt, ob das
// Modell ueberall gleich weit zurueckliegt oder ob es Teilmengen gibt, in denen es den
// Markt schlaegt. Das ist die entscheidende Frage fuer ein eigenstaendiges Modell:
// gleichmaessiger Rueckstand heisst "der Markt weiss durchweg mehr"; ein Muster heisst
// "hier ist Substanz, dort fehlt Information".

import { formatSummary, summarize } from "../eval/metrics";
import { pairedBootstrap } from "../eval/significance";
import { resolveScheme } from "../eval/scoringScheme";
import { seasonsFor } from "../eval/splits";
import {
  buildContexts,
  evaluateRun,
  toPerMatchMetrics,
  type MatchEvaluation,
  type RunSpec,
} from "../eval/backtestCore";

const scheme = resolveScheme(undefined);
const contexts = buildContexts(seasonsFor("all"));

const MODEL: RunSpec = { name: "modell", variant: "modelOnly", tipMode: "ev" };
const MARKT: RunSpec = { name: "markt", variant: "pureMarket", tipMode: "ev" };

const modelEval = evaluateRun(contexts, MODEL, scheme);
const marketEval = evaluateRun(contexts, MARKT, scheme);

// Gleiche Reihenfolge wie die Auswertungen, damit sich Index i auf beides bezieht.
const flatContexts = contexts.flatMap((s) => s.contexts);

function contextOf(i: number) {
  return flatContexts[i];
}

function disagreement(i: number): number {
  const model = modelEval[i].modelProbs;
  const market = modelEval[i].marketProbs;
  if (!market) return 0;
  return (
    (Math.abs(model.homeWinProb - market.homeWinProb) +
      Math.abs(model.drawProb - market.drawProb) +
      Math.abs(model.awayWinProb - market.awayWinProb)) /
    2
  );
}

console.log("=== Gesamt ===");
console.log(formatSummary("nur Modell", summarize(modelEval.map(toPerMatchMetrics))));
console.log(formatSummary("nur Markt", summarize(marketEval.map(toPerMatchMetrics))));

const overall = pairedBootstrap(modelEval.map((e, i) => marketEval[i].rps - e.rps));
console.log(
  `\nRPS-Abstand (positiv = Modell besser): ${overall.meanDiff >= 0 ? "+" : ""}${overall.meanDiff.toFixed(4)} ` +
    `[${overall.ciLow.toFixed(4)}, ${overall.ciHigh.toFixed(4)}], p = ${overall.pValue.toFixed(4)}\n`
);

// ---------------------------------------------------------------------------

interface Bucket {
  label: string;
  keep: (e: MatchEvaluation, i: number) => boolean;
}

function report(title: string, buckets: Bucket[]): void {
  console.log(`\n=== ${title} ===`);
  console.log("Teilmenge                  n     RPS Modell   RPS Markt   Abstand      p");

  for (const bucket of buckets) {
    const idx: number[] = [];
    for (let i = 0; i < modelEval.length; i++) {
      if (bucket.keep(modelEval[i], i)) idx.push(i);
    }
    if (idx.length < 40) continue;

    const model = summarize(idx.map((i) => toPerMatchMetrics(modelEval[i])));
    const market = summarize(idx.map((i) => toPerMatchMetrics(marketEval[i])));
    const test = pairedBootstrap(
      idx.map((i) => marketEval[i].rps - modelEval[i].rps),
      { iterations: 3000 }
    );

    const mark = test.meanDiff > 0 && test.pValue < 0.05 ? "✓" : test.meanDiff > 0 ? "·" : " ";
    console.log(
      `${mark} ${bucket.label.padEnd(24)} ${String(idx.length).padStart(4)}   ` +
        `${model.rps.toFixed(4)}       ${market.rps.toFixed(4)}     ` +
        `${test.meanDiff >= 0 ? "+" : ""}${test.meanDiff.toFixed(4)}     ${test.pValue.toFixed(3)}`
    );
  }
}

// Wie klar ist die Partie laut Markt?
report("Nach Favoritenstaerke (Markt)", [
  {
    label: "klarer Favorit (>65%)",
    keep: (e) => e.marketProbs !== null && Math.max(e.marketProbs.homeWinProb, e.marketProbs.awayWinProb) > 0.65,
  },
  {
    label: "Favorit (50-65%)",
    keep: (e) => {
      if (!e.marketProbs) return false;
      const max = Math.max(e.marketProbs.homeWinProb, e.marketProbs.awayWinProb);
      return max > 0.5 && max <= 0.65;
    },
  },
  {
    label: "offen (<50%)",
    keep: (e) => e.marketProbs !== null && Math.max(e.marketProbs.homeWinProb, e.marketProbs.awayWinProb) <= 0.5,
  },
]);

// Aufsteiger und Teams ohne belastbare Historie -- dort ist das Modell am schwaechsten
// informiert, der Markt aber auch.
report("Nach Datenlage", [
  { label: "beide etabliert", keep: (e, i) => !contextOf(i).homeIsEstimated && !contextOf(i).awayIsEstimated },
  { label: "mind. ein Aufsteiger", keep: (e, i) => contextOf(i).homeIsEstimated || contextOf(i).awayIsEstimated },
]);

// Torreiche gegen torarme Partien laut Modell.
report("Nach erwarteter Torsumme (Modell)", [
  { label: "torarm (< 2.6)", keep: (e) => e.lambdaHome + e.lambdaAway < 2.6 },
  { label: "mittel (2.6-3.2)", keep: (e) => e.lambdaHome + e.lambdaAway >= 2.6 && e.lambdaHome + e.lambdaAway < 3.2 },
  { label: "torreich (>= 3.2)", keep: (e) => e.lambdaHome + e.lambdaAway >= 3.2 },
]);

// Sind Modell und Markt sich einig? Wo sie auseinanderliegen, entscheidet sich, wer recht hat.
report("Nach Uebereinstimmung mit dem Markt", [
  { label: "einig (Diff < 5pp)", keep: (e, i) => disagreement(i) < 0.05 },
  { label: "leicht uneinig (5-12pp)", keep: (e, i) => disagreement(i) >= 0.05 && disagreement(i) < 0.12 },
  { label: "deutlich uneinig (>12pp)", keep: (e, i) => disagreement(i) >= 0.12 },
]);

report(
  "Nach Saison",
  seasonsFor("all").map((season) => ({ label: `Saison ${season}`, keep: (e: MatchEvaluation) => e.season === season }))
);

// ---------------------------------------------------------------------------

console.log(
  "\n\n✓ = Modell schlaegt den Markt signifikant, · = Modell vorn aber nicht signifikant."
);
