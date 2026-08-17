// Hyperparametersuche fuer das EIGENSTAENDIGE Modell -- ohne Markt.
//
//   npm run tune-model
//
// Getrennt von tune.ts, und zwar aus einem inhaltlichen Grund: mit aktiven
// Marktbedingungen sind Modellverbesserungen praktisch unsichtbar. Das haben zwei
// Messungen gezeigt -- der konvergierte Fit (RPS 0.2088 -> 0.2042 ohne Markt, aber
// wirkungslos mit) und die Formkurve (+0.0025 ohne, +0.0012 mit). Wer am Modell arbeitet
// und die Gesamtzahl anschaut, sieht deshalb nie etwas.
//
// Zielgroesse ist hier also modelOnly-RPS. Referenz: 0.2042 (aktuelles Modell),
// zu schlagen waere der reine Markt mit 0.1978.

import { formatSummary, summarize } from "../eval/metrics";
import { pairedBootstrap } from "../eval/significance";
import { resolveScheme } from "../eval/scoringScheme";
import { parseSplit, seasonsFor, warnIfTestSplit, type SplitName } from "../eval/splits";
import {
  buildContexts,
  evaluateRun,
  toPerMatchMetrics,
  type MatchEvaluation,
  type RunSpec,
} from "../eval/backtestCore";
import type { LeagueModelOptions } from "../model/teamStrength";

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

const ACCEPT_THRESHOLD = 0.002;

const split: SplitName = flag("split") ? parseSplit(flag("split")) : "validation";
const scheme = resolveScheme(undefined);
warnIfTestSplit(split);

const seasons = seasonsFor(split);
console.log(`Modellsuche auf "${split}" (${seasons.join(", ")}), Zielgroesse: modelOnly-RPS`);
console.log(`Annahmeschwelle ΔRPS > ${ACCEPT_THRESHOLD}\n`);

// Ohne Markt und ohne Marktbedingungen -- hier soll ausschliesslich das Modell wirken.
const RUN: RunSpec = { name: "modell", variant: "modelOnly", tipMode: "ev" };
// Marktreferenz auf denselben Spielen, damit der Abstand sichtbar bleibt.
const MARKT: RunSpec = { name: "markt", variant: "pureMarket", tipMode: "ev" };

interface Candidate {
  label: string;
  model: LeagueModelOptions;
}

const candidates: Candidate[] = [{ label: "Ausgang (Saisonbloecke, Tore)", model: {} }];

// Hebel 1: Halbwertszeit der Zeitgewichtung. 60 Tage ist sehr kurz (gut zwei Monate),
// 700 Tage entspricht ungefaehr der bisherigen Reichweite ueber mehrere Saisons.
const HALF_LIVES = [60, 90, 120, 180, 250, 365, 500, 700];
for (const halfLifeDays of HALF_LIVES) {
  candidates.push({ label: `Halbwertszeit ${halfLifeDays}d`, model: { halfLifeDays } });
}

// Hebel 2: Fit-Ziel. xgBlendWeight ist der Anteil der echten Tore.
for (const [label, model] of [
  ["nur xG", { target: "xg" as const }],
  ["70% xG / 30% Tore", { target: "blend" as const, xgBlendWeight: 0.3 }],
  ["50/50", { target: "blend" as const, xgBlendWeight: 0.5 }],
  ["30% xG / 70% Tore", { target: "blend" as const, xgBlendWeight: 0.7 }],
] as [string, LeagueModelOptions][]) {
  candidates.push({ label, model });
}

// Beide Hebel zusammen -- die interessanteste Frage, weil sie sich ergaenzen koennten:
// xG glaettet das Rauschen, die Zeitgewichtung schaerft die Aktualitaet.
for (const halfLifeDays of [90, 180, 365]) {
  for (const [suffix, extra] of [
    ["nur xG", { target: "xg" as const }],
    ["50/50", { target: "blend" as const, xgBlendWeight: 0.5 }],
  ] as [string, LeagueModelOptions][]) {
    candidates.push({
      label: `${halfLifeDays}d + ${suffix}`,
      model: { halfLifeDays, ...extra },
    });
  }
}

// Matrixparameter kosten keinen Refit -- sie werden deshalb getrennt und feiner
// durchsucht, auf den Kontexten der jeweils besten Modellkonfiguration.
const RHOS = [-0.3, -0.25, -0.2, -0.15, -0.1, -0.05, 0, 0.05];
const DRAW_BOOSTS = [0.9, 0.95, 1.0, 1.05, 1.1, 1.15, 1.2, 1.25];

const baselineContexts = buildContexts(seasons, {});
const baselineEval = evaluateRun(baselineContexts, RUN, scheme);
const baselineSummary = summarize(baselineEval.map(toPerMatchMetrics));
const marketEval = evaluateRun(baselineContexts, MARKT, scheme);
const marketSummary = summarize(marketEval.map(toPerMatchMetrics));

console.log(formatSummary("AUSGANG (Modell)", baselineSummary));
console.log(formatSummary("ZIEL (reiner Markt)", marketSummary));
console.log(
  `\nZu schliessender Abstand: ${(baselineSummary.rps - marketSummary.rps).toFixed(4)} RPS\n`
);

// Die Teilmenge, in der sich alles entscheidet: wo Modell und Markt deutlich
// auseinanderliegen, hatte bisher systematisch der Markt recht. Eine echte
// Modellverbesserung muss genau dort den Abstand verkleinern -- der Gesamtmittelwert
// allein kann auch durch die unstrittigen Spiele getragen werden.
function disagreementIndices(evaluations: MatchEvaluation[]): number[] {
  const idx: number[] = [];
  for (let i = 0; i < evaluations.length; i++) {
    const e = evaluations[i];
    if (!e.marketProbs) continue;
    const d =
      (Math.abs(e.modelProbs.homeWinProb - e.marketProbs.homeWinProb) +
        Math.abs(e.modelProbs.drawProb - e.marketProbs.drawProb) +
        Math.abs(e.modelProbs.awayWinProb - e.marketProbs.awayWinProb)) /
      2;
    if (d >= 0.12) idx.push(i);
  }
  return idx;
}

const baseDisagree = disagreementIndices(baselineEval);
const baseDisagreeGap =
  summarize(baseDisagree.map((i) => toPerMatchMetrics(baselineEval[i]))).rps -
  summarize(baseDisagree.map((i) => toPerMatchMetrics(marketEval[i]))).rps;

console.log(
  `Widerspruchsfaelle (>12pp) im Ausgang: ${baseDisagree.length} Spiele, ` +
    `RPS-Abstand zum Markt ${baseDisagreeGap >= 0 ? "+" : ""}${baseDisagreeGap.toFixed(4)}\n`
);

interface Scored {
  label: string;
  model: LeagueModelOptions;
  rps: number;
  points: number;
  deltaRps: number;
  pValue: number;
  gapToMarket: number;
  disagreeGap: number;
  disagreeCount: number;
  accepted: boolean;
}

const results: Scored[] = [];

for (const candidate of candidates) {
  const contexts = buildContexts(seasons, candidate.model);
  const evaluations = evaluateRun(contexts, RUN, scheme);
  const summary = summarize(evaluations.map(toPerMatchMetrics));

  const diffs = evaluations.map((e, i) => baselineEval[i].rps - e.rps);
  const test = pairedBootstrap(diffs, { iterations: 4000 });

  const disagree = disagreementIndices(evaluations);
  const disagreeGap =
    disagree.length > 0
      ? summarize(disagree.map((i) => toPerMatchMetrics(evaluations[i]))).rps -
        summarize(disagree.map((i) => toPerMatchMetrics(marketEval[i]))).rps
      : 0;

  results.push({
    label: candidate.label,
    model: candidate.model,
    rps: summary.rps,
    points: summary.pointsPerMatch,
    deltaRps: test.meanDiff,
    pValue: test.pValue,
    gapToMarket: summary.rps - marketSummary.rps,
    disagreeGap,
    disagreeCount: disagree.length,
    accepted: test.meanDiff > ACCEPT_THRESHOLD && test.pValue < 0.05,
  });
}

results.sort((a, b) => b.deltaRps - a.deltaRps);

console.log(
  "Kandidat                        RPS      Pkt      ΔRPS      p       Abst.Markt   Widerspruch"
);
console.log("".padEnd(100, "-"));
for (const r of results) {
  const mark = r.accepted ? "✓" : r.deltaRps > 0 ? "·" : " ";
  console.log(
    `${mark} ${r.label.padEnd(30)} ${r.rps.toFixed(4)}  ${r.points.toFixed(3)}  ` +
      `${r.deltaRps >= 0 ? "+" : ""}${r.deltaRps.toFixed(4)}  ${r.pValue.toFixed(3)}   ` +
      `${r.gapToMarket >= 0 ? "+" : ""}${r.gapToMarket.toFixed(4)}      ` +
      `${r.disagreeGap >= 0 ? "+" : ""}${r.disagreeGap.toFixed(4)} (${r.disagreeCount})`
  );
}

const accepted = results.filter((r) => r.accepted);
console.log(
  `\n${accepted.length} von ${results.length} Kandidaten ueberschreiten ${ACCEPT_THRESHOLD} RPS bei p < 0.05.`
);

// ---------------------------------------------------------------------------
// Matrixparameter. RHO = -0.15 und DRAW_BOOST = 1.2 sind seit jeher geraten und nie
// gemessen worden. DRAW_BOOST ist dabei kein Wahrscheinlichkeitsmodell, sondern ein
// Eingriff: er blaeht jede Unentschieden-Zelle auf und drueckt nach der Normalisierung
// Heim- und Auswaertssieg. Auf einer Kalibrierungsmetrik wie dem RPS sollte sich das
// zeigen.
console.log("\n\n=== Matrixparameter (kein Refit noetig) ===\n");

function rpsOf(spec: RunSpec): { rps: number; points: number; diffs: number[] } {
  const evaluations = evaluateRun(baselineContexts, spec, scheme);
  const summary = summarize(evaluations.map(toPerMatchMetrics));
  return {
    rps: summary.rps,
    points: summary.pointsPerMatch,
    diffs: evaluations.map((e, i) => baselineEval[i].rps - e.rps),
  };
}

console.log("DRAW_BOOST (bei RHO = -0.15)");
console.log("  Wert     RPS      Pkt      ΔRPS      p");
for (const drawBoost of DRAW_BOOSTS) {
  const r = rpsOf({ ...RUN, drawBoost });
  const test = pairedBootstrap(r.diffs, { iterations: 4000 });
  const mark = Math.abs(drawBoost - 1.2) < 1e-9 ? "  <- aktuell" : "";
  console.log(
    `  ${drawBoost.toFixed(2)}    ${r.rps.toFixed(4)}  ${r.points.toFixed(3)}  ` +
      `${test.meanDiff >= 0 ? "+" : ""}${test.meanDiff.toFixed(4)}  ${test.pValue.toFixed(3)}${mark}`
  );
}

console.log("\nRHO (bei bestem DRAW_BOOST)");
const bestBoost = DRAW_BOOSTS.map((b) => ({ b, rps: rpsOf({ ...RUN, drawBoost: b }).rps })).sort(
  (x, y) => x.rps - y.rps
)[0].b;
console.log(`  (bestes DRAW_BOOST: ${bestBoost})`);
console.log("  Wert     RPS      Pkt      ΔRPS      p");
for (const rho of RHOS) {
  const r = rpsOf({ ...RUN, rho, drawBoost: bestBoost });
  const test = pairedBootstrap(r.diffs, { iterations: 4000 });
  const mark = Math.abs(rho + 0.15) < 1e-9 ? "  <- aktuell" : "";
  console.log(
    `  ${rho >= 0 ? " " : ""}${rho.toFixed(2)}    ${r.rps.toFixed(4)}  ${r.points.toFixed(3)}  ` +
      `${test.meanDiff >= 0 ? "+" : ""}${test.meanDiff.toFixed(4)}  ${test.pValue.toFixed(3)}${mark}`
  );
}

if (accepted.length > 0) {
  const best = accepted[0];
  console.log(`\nBester: ${best.label}  ${JSON.stringify(best.model)}`);
  console.log(
    `  modelOnly-RPS ${baselineSummary.rps.toFixed(4)} -> ${best.rps.toFixed(4)}  ` +
      `(Markt: ${marketSummary.rps.toFixed(4)})`
  );
  console.log(
    `  Abstand zum Markt: ${(baselineSummary.rps - marketSummary.rps).toFixed(4)} -> ${best.gapToMarket.toFixed(4)}`
  );
  console.log(
    `  In den Widerspruchsfaellen: ${baseDisagreeGap.toFixed(4)} -> ${best.disagreeGap.toFixed(4)}`
  );
  console.log(
    `\nDer Gewinner ist als Maximum ueber ${results.length} Kandidaten optimistisch verzerrt.\n` +
      `Ehrlich wird die Zahl erst im Testset-Report.`
  );
}
