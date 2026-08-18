// Hyperparametersuche fuer das eigenstaendige Modell.
//
//   npm run tune-model
//   npm run tune-model -- --objective=score
//   npm run tune-model -- --split=validation
//
// Zielgroesse waehlbar, und das ist wichtiger als es aussieht:
//
//   rps      Ranked Probability Score auf 1X2. Die Standardmetrik, aber sie sieht nur
//            drei aggregierte Massen.
//   logloss  LogLoss auf 1X2. Empfindlicher fuer Ueberzeugung als der RPS.
//   totals   LogLoss auf "mehr als 2.5 Tore". Misst das Torniveau.
//   score    LogLoss auf dem exakten Ergebnis. Die einzige Zielgroesse, die die FORM der
//            Verteilung sieht.
//
// Genau daran hing bisher ein Problem: RHO und DRAW_BOOST verschieben Masse INNERHALB
// einer Tendenz. Der RPS ist dafuer bauartbedingt blind, und deshalb wurden diese beiden
// Parameter frueher an Tippspiel-Punkten gewaehlt -- einer Zielgroesse, die mit dem Ziel
// dieses Projekts nichts zu tun hat. Correct-Score-LogLoss misst dieselbe Sache, ist eine
// strikt propere Bewertungsregel und braucht kein Punkteschema. Fuer RHO und DRAW_BOOST
// ist "--objective=score" also die richtige Wahl.

import { formatSummary, summarize, type MetricSummary } from "../eval/metrics";
import { pairedBootstrap } from "../eval/significance";
import { parseSplit, seasonsFor, warnIfTestSplit, type SplitName } from "../eval/splits";
import {
  buildContexts,
  evaluateRun,
  type MatchEvaluation,
  type RunSpec,
} from "../eval/backtestCore";
import { BENCHMARK_LABELS, parseBenchmarkSource } from "../eval/benchmarkOdds";
import { loadAllMatches } from "../data/loadMatches";
import { buildLeagueModel, type LeagueModelOptions } from "../model/teamStrength";

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

type Objective = "rps" | "logloss" | "totals" | "score";

const OBJECTIVES: Record<Objective, { label: string; pick: (e: MatchEvaluation) => number | null; of: (s: MetricSummary) => number }> = {
  rps: { label: "1X2 RPS", pick: (e) => e.metrics.rps, of: (s) => s.rps },
  logloss: { label: "1X2 LogLoss", pick: (e) => e.metrics.logLoss, of: (s) => s.logLoss },
  totals: { label: "O/U 2.5 LogLoss", pick: (e) => e.metrics.totals?.logLoss ?? null, of: (s) => s.totalsLogLoss },
  score: { label: "Correct Score LogLoss", pick: (e) => e.metrics.scoreLogLoss, of: (s) => s.scoreLogLoss },
};

function parseObjective(raw?: string): Objective {
  if (raw === "logloss" || raw === "totals" || raw === "score" || raw === "rps") return raw;
  return "rps";
}

// Schwelle in RPS-Einheiten. LogLoss-Skalen sind groeber, deshalb je Zielgroesse eigen.
const THRESHOLDS: Record<Objective, number> = {
  rps: 0.002,
  logloss: 0.005,
  totals: 0.005,
  score: 0.005,
};

const split: SplitName = flag("split") ? parseSplit(flag("split")) : "validation";
const objective = parseObjective(flag("objective"));
const source = parseBenchmarkSource(flag("benchmark"));
const threshold = THRESHOLDS[objective];
const obj = OBJECTIVES[objective];

warnIfTestSplit(split);

const seasons = seasonsFor(split);
const allMatches = loadAllMatches();

console.log(`Modellsuche auf "${split}" (${seasons.join(", ")})`);
console.log(`Zielgroesse: ${obj.label}, Annahmeschwelle Δ > ${threshold}\n`);

const RUN: RunSpec = { name: "modell", variant: "model" };
const MARKT: RunSpec = { name: "markt", variant: "benchmark" };

interface Candidate {
  label: string;
  model: LeagueModelOptions;
}

const candidates: Candidate[] = [{ label: "Ausgang (Saisonbloecke, Tore)", model: {} }];

// Hebel 1: Halbwertszeit der Zeitgewichtung. 60 Tage ist sehr kurz (gut zwei Monate),
// 700 Tage entspricht ungefaehr der bisherigen Reichweite ueber mehrere Saisons.
for (const halfLifeDays of [60, 90, 120, 180, 250, 365, 500, 700]) {
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
    candidates.push({ label: `${halfLifeDays}d + ${suffix}`, model: { halfLifeDays, ...extra } });
  }
}

const baselineContexts = buildContexts(seasons, {}, allMatches, buildLeagueModel, source);
const baselineEval = evaluateRun(baselineContexts, RUN);
const baselineSummary = summarize(baselineEval.map((e) => e.metrics));
const marketEval = evaluateRun(baselineContexts, MARKT);
const marketSummary = summarize(marketEval.map((e) => e.metrics));

console.log(formatSummary("AUSGANG (Modell)", baselineSummary));
console.log(formatSummary(`ZIEL (${BENCHMARK_LABELS[source]})`, marketSummary));

const startGap = obj.of(baselineSummary) - obj.of(marketSummary);
console.log(`\nZu schliessender Abstand auf ${obj.label}: ${startGap.toFixed(4)}\n`);

// Die Teilmenge, in der sich alles entscheidet: wo Modell und Markt deutlich
// auseinanderliegen, hatte bisher systematisch der Markt recht. Eine echte
// Modellverbesserung muss genau dort den Abstand verkleinern -- der Gesamtmittelwert
// allein kann auch durch die unstrittigen Spiele getragen werden.
function disagreementIndices(evaluations: MatchEvaluation[]): number[] {
  const idx: number[] = [];
  for (let i = 0; i < evaluations.length; i++) {
    const e = evaluations[i];
    const m = e.benchmarkProbs;
    if (!m) continue;
    const d =
      (Math.abs(e.probs.homeWinProb - m.homeWinProb) +
        Math.abs(e.probs.drawProb - m.drawProb) +
        Math.abs(e.probs.awayWinProb - m.awayWinProb)) /
      2;
    if (d >= 0.12) idx.push(i);
  }
  return idx;
}

function objectiveGapOn(indices: number[], evaluations: MatchEvaluation[]): number {
  if (indices.length === 0) return 0;
  return (
    obj.of(summarize(indices.map((i) => evaluations[i].metrics))) -
    obj.of(summarize(indices.map((i) => marketEval[i].metrics)))
  );
}

const baseDisagree = disagreementIndices(baselineEval);
console.log(
  `Widerspruchsfaelle (>12pp) im Ausgang: ${baseDisagree.length} Spiele, ` +
    `Abstand zum Markt ${formatSigned(objectiveGapOn(baseDisagree, baselineEval))}\n`
);

function formatSigned(x: number): string {
  return `${x >= 0 ? "+" : ""}${x.toFixed(4)}`;
}

// Gepaarte Differenzen der Zielgroesse gegen den Ausgang, nur ueber Spiele, auf denen
// beide Laeufe die Metrik ueberhaupt liefern.
function pairedDiffs(evaluations: MatchEvaluation[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < evaluations.length; i++) {
    const a = obj.pick(baselineEval[i]);
    const b = obj.pick(evaluations[i]);
    if (a === null || b === null) continue;
    out.push(a - b);
  }
  return out;
}

interface Scored {
  label: string;
  model: LeagueModelOptions;
  value: number;
  delta: number;
  pValue: number;
  gapToMarket: number;
  disagreeGap: number;
  disagreeCount: number;
  accepted: boolean;
}

const results: Scored[] = [];

for (const candidate of candidates) {
  const contexts = buildContexts(seasons, candidate.model, allMatches, buildLeagueModel, source);
  const evaluations = evaluateRun(contexts, RUN);
  const summary = summarize(evaluations.map((e) => e.metrics));
  const test = pairedBootstrap(pairedDiffs(evaluations), { iterations: 4000 });
  const disagree = disagreementIndices(evaluations);

  results.push({
    label: candidate.label,
    model: candidate.model,
    value: obj.of(summary),
    delta: test.meanDiff,
    pValue: test.pValue,
    gapToMarket: obj.of(summary) - obj.of(marketSummary),
    disagreeGap: objectiveGapOn(disagree, evaluations),
    disagreeCount: disagree.length,
    accepted: test.meanDiff > threshold && test.pValue < 0.05,
  });
}

results.sort((a, b) => b.delta - a.delta);

console.log("Kandidat                          Wert       Δ         p       Abst.Markt   Widerspruch");
console.log("".padEnd(100, "-"));
for (const r of results) {
  const mark = r.accepted ? "✓" : r.delta > 0 ? "·" : " ";
  console.log(
    `${mark} ${r.label.padEnd(30)} ${r.value.toFixed(4)}  ${formatSigned(r.delta)}  ` +
      `${r.pValue.toFixed(3)}   ${formatSigned(r.gapToMarket)}      ` +
      `${formatSigned(r.disagreeGap)} (${r.disagreeCount})`
  );
}

const accepted = results.filter((r) => r.accepted);
console.log(
  `\n${accepted.length} von ${results.length} Kandidaten ueberschreiten ${threshold} bei p < 0.05.`
);

// ---------------------------------------------------------------------------
// Matrixparameter. Sie kosten keinen Refit und werden deshalb getrennt und feiner
// durchsucht -- und zwar auf ALLEN Zielgroessen gleichzeitig, weil RHO und DRAW_BOOST
// genau die Dimension betreffen, fuer die der RPS blind ist.

console.log("\n\n=== Matrixparameter (kein Refit noetig) ===\n");

function scanRow(spec: RunSpec): string {
  const evaluations = evaluateRun(baselineContexts, spec);
  const s = summarize(evaluations.map((e) => e.metrics));
  const test = pairedBootstrap(pairedDiffs(evaluations), { iterations: 4000 });
  return (
    `${s.rps.toFixed(4)}  ${s.logLoss.toFixed(4)}   ${s.totalsLogLoss.toFixed(4)}  ` +
    `${s.scoreLogLoss.toFixed(4)}   ${formatSigned(test.meanDiff)}  ${test.pValue.toFixed(3)}`
  );
}

const DRAW_BOOSTS = [0.9, 0.95, 1.0, 1.05, 1.1, 1.15, 1.2, 1.25];
const RHOS = [-0.3, -0.25, -0.2, -0.15, -0.1, -0.05, 0, 0.05];

console.log("DRAW_BOOST (bei RHO = -0.15)");
console.log("  Wert      RPS   LogLoss     O/U     Score      Δ Ziel      p");
for (const drawBoost of DRAW_BOOSTS) {
  const mark = Math.abs(drawBoost - 1.0) < 1e-9 ? "  <- aktuell" : "";
  console.log(`  ${drawBoost.toFixed(2)}    ${scanRow({ ...RUN, drawBoost })}${mark}`);
}

console.log("\nRHO (bei DRAW_BOOST = 1.0)");
console.log("  Wert      RPS   LogLoss     O/U     Score      Δ Ziel      p");
for (const rho of RHOS) {
  const mark = Math.abs(rho + 0.15) < 1e-9 ? "  <- aktuell" : "";
  console.log(`  ${rho >= 0 ? " " : ""}${rho.toFixed(2)}    ${scanRow({ ...RUN, rho })}${mark}`);
}

if (accepted.length > 0) {
  const best = accepted[0];
  console.log(`\nBester Kandidat: ${best.label}  ${JSON.stringify(best.model)}`);
  console.log(
    `  ${obj.label}: ${obj.of(baselineSummary).toFixed(4)} -> ${best.value.toFixed(4)}  ` +
      `(Markt: ${obj.of(marketSummary).toFixed(4)})`
  );
  console.log(`  Abstand zum Markt: ${formatSigned(startGap)} -> ${formatSigned(best.gapToMarket)}`);
  console.log(
    `\nDer Gewinner ist als Maximum ueber ${results.length} Kandidaten optimistisch verzerrt.\n` +
      `Ehrlich wird die Zahl erst auf dem Testset.`
  );
}
