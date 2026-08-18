// Die eine Auswertung, um die es in diesem Projekt geht: wie weit ist das Modell vom
// Buchmacher entfernt, und WO genau verliert es?
//
//   npm run benchmark
//   npm run benchmark -- --split=validation
//   npm run benchmark -- --benchmark=marketAverageOpen
//
// Der Gesamtmittelwert allein taugt nicht als Fortschrittsanzeige. Er kann von den
// unstrittigen Spielen getragen werden -- Bayern gegen einen Aufsteiger sagen Modell und
// Markt gleich voraus, und beide liegen dort meistens richtig. Der gesamte Rueckstand
// steckt erfahrungsgemaess in den Faellen, in denen sich beide WIDERSPRECHEN, und dort
// hatte bisher systematisch der Markt recht.
//
// Vorsicht bei genau dieser Teilmenge: sie ist konfundiert. Wird das Modell einfach
// marktaehnlicher, schrumpft die Teilmenge und der Abstand darin sinkt trivial -- ohne
// dass irgendetwas dazugelernt wurde. Deshalb steht die Fallzahl immer daneben.

import { calibrationBins } from "../eval/calibration";
import { formatSummary, summarize, type PerMatchMetrics } from "../eval/metrics";
import { formatBootstrap, pairedBootstrap } from "../eval/significance";
import { parseSplit, seasonsFor, warnIfTestSplit, type SplitName } from "../eval/splits";
import { buildContexts, evaluateRun, type MatchEvaluation } from "../eval/backtestCore";
import { BENCHMARK_LABELS, parseBenchmarkSource } from "../eval/benchmarkOdds";
import { buildLeagueModel } from "../model/teamStrength";
import { loadAllMatches } from "../data/loadMatches";
import type { OutcomeProbs } from "../eval/metrics";

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

const split: SplitName = flag("split") ? parseSplit(flag("split")) : "all";
const source = parseBenchmarkSource(flag("benchmark"));

warnIfTestSplit(split);

const seasons = seasonsFor(split);
const contexts = buildContexts(seasons, {}, loadAllMatches(), buildLeagueModel, source);

const model = evaluateRun(contexts, { name: "model", variant: "model" });
const market = evaluateRun(contexts, { name: "benchmark", variant: "benchmark" });
const base = evaluateRun(contexts, { name: "baseRate", variant: "baseRate" });

if (model.length !== market.length || model.length !== base.length) {
  throw new Error("Laeufe unterschiedlich lang -- gepaarter Vergleich unmoeglich");
}

console.log(
  `Split "${split}" (${seasons.join(", ")}), Messlatte "${BENCHMARK_LABELS[source]}", ` +
    `${model.length} Spiele\n`
);

console.log(formatSummary("Modell", summarize(model.map((e) => e.metrics))));
console.log(formatSummary("Buchmacher", summarize(market.map((e) => e.metrics))));
console.log(formatSummary("Grundrate", summarize(base.map((e) => e.metrics))));

// ---------------------------------------------------------------------------
// Markt fuer Markt. Ein Modell kann auf 1X2 gleichauf liegen und auf der Torsumme
// deutlich danebenliegen -- das waere unsichtbar, solange nur eine Zahl berichtet wird.

console.log("\n\n=== Abstand je Markt (positiv = Modell besser) ===\n");

type MetricPick = (m: PerMatchMetrics) => number | null;

const MARKETS: [string, MetricPick][] = [
  ["1X2 (RPS)", (m) => m.rps],
  ["1X2 (LogLoss)", (m) => m.logLoss],
  ["1X2 (Brier)", (m) => m.brier],
  ["Over/Under 2.5", (m) => m.totals?.logLoss ?? null],
  ["Asian Handicap", (m) => m.handicap?.logLoss ?? null],
];

for (const [label, pick] of MARKETS) {
  const diffs: number[] = [];
  for (let i = 0; i < model.length; i++) {
    const a = pick(model[i].metrics);
    const b = pick(market[i].metrics);
    if (a === null || b === null) continue;
    diffs.push(b - a);
  }
  if (diffs.length === 0) {
    console.log(`${label.padEnd(18)} keine gemeinsamen Spiele`);
    continue;
  }
  const test = pairedBootstrap(diffs, { iterations: 4000 });
  console.log(`${label.padEnd(18)} n=${String(diffs.length).padStart(4)}  ${formatBootstrap("", test).trim()}`);
}

// Correct Score kann der Buchmacher hier nicht liefern -- die historischen Daten
// enthalten diesen Markt nicht, und live hat er ~41 Prozent Overround, womit
// proportionales Entvigen grob falsch waere. Verglichen wird deshalb gegen die Grundrate.
const scoreDiffs: number[] = [];
for (let i = 0; i < model.length; i++) {
  const a = model[i].metrics.scoreLogLoss;
  const b = base[i].metrics.scoreLogLoss;
  if (a === null || b === null) continue;
  scoreDiffs.push(b - a);
}
if (scoreDiffs.length > 0) {
  const test = pairedBootstrap(scoreDiffs, { iterations: 4000 });
  console.log(
    `\nCorrect Score gegen die Grundrate (kein Buchmacher-Gegenstueck vorhanden):\n` +
      `  ${formatBootstrap("Modell vs Grundrate", test)}`
  );
}

// ---------------------------------------------------------------------------
// Wo verliert das Modell?

function tvDistance(a: OutcomeProbs, b: OutcomeProbs): number {
  return (
    (Math.abs(a.homeWinProb - b.homeWinProb) +
      Math.abs(a.drawProb - b.drawProb) +
      Math.abs(a.awayWinProb - b.awayWinProb)) /
    2
  );
}

function favouriteStrength(p: OutcomeProbs): number {
  return Math.max(p.homeWinProb, p.drawProb, p.awayWinProb);
}

interface Segment {
  label: string;
  indices: number[];
}

function segmentReport(title: string, segments: Segment[]): void {
  console.log(`\n\n=== ${title} ===\n`);
  console.log("Teilmenge                     n     RPS Modell   RPS Markt   Abstand      p");
  console.log("".padEnd(80, "-"));

  for (const seg of segments) {
    if (seg.indices.length === 0) {
      console.log(`${seg.label.padEnd(28)}     0          —           —          —        —`);
      continue;
    }
    const modelRps = summarize(seg.indices.map((i) => model[i].metrics)).rps;
    const marketRps = summarize(seg.indices.map((i) => market[i].metrics)).rps;
    const diffs = seg.indices.map((i) => market[i].metrics.rps - model[i].metrics.rps);
    const test = pairedBootstrap(diffs, { iterations: 4000 });
    const gap = modelRps - marketRps;

    console.log(
      `${seg.label.padEnd(28)} ${String(seg.indices.length).padStart(5)}   ` +
        `${modelRps.toFixed(4)}      ${marketRps.toFixed(4)}     ` +
        `${gap >= 0 ? "+" : ""}${gap.toFixed(4)}    ${test.pValue.toFixed(4)}`
    );
  }
}

const disagreement = model.map((e, i) =>
  market[i].probs ? tvDistance(e.probs, market[i].probs) : 0
);

segmentReport("Nach Meinungsverschiedenheit zwischen Modell und Markt", [
  { label: "einig (< 4pp)", indices: indicesWhere((i) => disagreement[i] < 0.04) },
  { label: "leicht uneinig (4-8pp)", indices: indicesWhere((i) => disagreement[i] >= 0.04 && disagreement[i] < 0.08) },
  { label: "uneinig (8-12pp)", indices: indicesWhere((i) => disagreement[i] >= 0.08 && disagreement[i] < 0.12) },
  { label: "deutlich uneinig (>12pp)", indices: indicesWhere((i) => disagreement[i] >= 0.12) },
]);

segmentReport("Nach Klarheit der Partie (Markt-Favorit)", [
  { label: "offen (< 40%)", indices: indicesWhere((i) => favouriteStrength(market[i].probs) < 0.4) },
  { label: "leichter Favorit (40-55%)", indices: indicesWhere((i) => { const f = favouriteStrength(market[i].probs); return f >= 0.4 && f < 0.55; }) },
  { label: "klarer Favorit (55-70%)", indices: indicesWhere((i) => { const f = favouriteStrength(market[i].probs); return f >= 0.55 && f < 0.7; }) },
  { label: "sehr klar (> 70%)", indices: indicesWhere((i) => favouriteStrength(market[i].probs) >= 0.7) },
]);

segmentReport(
  "Nach Saison",
  seasons.map((season) => ({
    label: `Saison ${season}`,
    indices: indicesWhere((i) => model[i].season === season),
  }))
);

function indicesWhere(predicate: (i: number) => boolean): number[] {
  const out: number[] = [];
  for (let i = 0; i < model.length; i++) if (predicate(i)) out.push(i);
  return out;
}

// ---------------------------------------------------------------------------
// Kalibrierung. RPS und LogLoss sagen, DASS etwas nicht stimmt, nicht WO.

console.log("\n\n=== Kalibrierung (sagt das Modell 30%, tritt es dann in 30% ein?) ===\n");

function calibrationOf(runs: MatchEvaluation[]) {
  return calibrationBins(runs.map((e) => ({ probs: e.probs, actual: e.actual })));
}

const modelCal = calibrationOf(model);
const marketCal = calibrationOf(market);

console.log("Klasse        n Modell   gesagt   eingetreten     n Markt   gesagt   eingetreten");
console.log("".padEnd(84, "-"));
for (let i = 0; i < modelCal.bins.length; i++) {
  const a = modelCal.bins[i];
  const b = marketCal.bins[i];
  if (a.n === 0 && b.n === 0) continue;
  console.log(
    `${(a.from * 100).toFixed(0).padStart(3)}-${(a.to * 100).toFixed(0).padEnd(3)}  ` +
      `${String(a.n).padStart(8)}   ${(a.meanPredicted * 100).toFixed(1).padStart(6)}   ` +
      `${(a.observed * 100).toFixed(1).padStart(11)}   ` +
      `${String(b.n).padStart(9)}   ${(b.meanPredicted * 100).toFixed(1).padStart(6)}   ` +
      `${(b.observed * 100).toFixed(1).padStart(11)}`
  );
}

console.log(
  `\nMittlerer Kalibrierungsfehler: Modell ${(modelCal.expectedCalibrationError * 100).toFixed(2)}pp, ` +
    `Buchmacher ${(marketCal.expectedCalibrationError * 100).toFixed(2)}pp`
);

console.log(
  `\nFortschritt heisst: der Abstand in der Zeile "deutlich uneinig" wird kleiner, OHNE\n` +
    `dass die Fallzahl dort zusammenbricht. Schrumpft nur die Fallzahl, ist das Modell\n` +
    `lediglich marktaehnlicher geworden und hat nichts gelernt.`
);
