// Wie schnell soll das Modell INNERHALB der Saison reagieren?
//
//   npm run walk-forward
//   npm run walk-forward -- --split=validation --objective=logloss
//
// Diese Frage war bis zum 10.09.2026 nicht beantwortbar, und das ist der Grund, warum es
// dieses Skript gibt.
//
// buildContexts trainiert ausnahmslos auf Saisons VOR der Testsaison. Die juengste
// Trainingssaison ist dort also immer vollstaendig, und der Zustand "mitten in einer
// angefangenen Saison" -- der Zustand, in dem das Modell jeden Samstag wirklich laeuft --
// kommt kein einziges Mal vor. halfLifeDays und ridgePseudoMatches wurden damit
// ausschliesslich auf die Frage "wie weit soll die Historie zurueckreichen" gemessen.
// Die andere Haelfte ihrer Wirkung, die Reaktionsgeschwindigkeit im Saisonverlauf, hatte
// nie ein Messgeraet.
//
// buildWalkForwardContexts fittet vor jedem Spieltag neu, mit allem bis dahin Gespielten.
// Erst damit sehen die Kandidaten die Lage, um die es geht.
//
// Das Skript aendert NICHTS an der Vorhersage. Es liegt vollstaendig in der Auswertung und
// ist rueckwirkend auf alle geloggten Zeilen anwendbar -- siehe SAISONBETRIEB.md,
// Abschnitt "Frei -- jederzeit aenderbar".

import { formatSummary, summarize, type MetricSummary } from "../eval/metrics";
import { pairedBootstrap } from "../eval/significance";
import { parseSplit, seasonsFor, warnIfTestSplit, type SplitName } from "../eval/splits";
import {
  buildContexts,
  buildWalkForwardContexts,
  evaluateRun,
  type MatchEvaluation,
  type RunSpec,
  type SeasonContexts,
} from "../eval/backtestCore";
import { BENCHMARK_LABELS, parseBenchmarkSource } from "../eval/benchmarkOdds";
import { loadAllMatches } from "../data/loadMatches";
import {
  PRODUCTION_MODEL_OPTIONS,
  buildLeagueModel,
  type LeagueModelOptions,
} from "../model/teamStrength";

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

type Objective = "rps" | "logloss" | "score";

const OBJECTIVES: Record<
  Objective,
  { label: string; pick: (e: MatchEvaluation) => number | null; of: (s: MetricSummary) => number }
> = {
  rps: { label: "1X2 RPS", pick: (e) => e.metrics.rps, of: (s) => s.rps },
  logloss: { label: "1X2 LogLoss", pick: (e) => e.metrics.logLoss, of: (s) => s.logLoss },
  score: { label: "Correct Score LogLoss", pick: (e) => e.metrics.scoreLogLoss, of: (s) => s.scoreLogLoss },
};

function parseObjective(raw?: string): Objective {
  if (raw === "logloss" || raw === "score") return raw;
  return "rps";
}

const split: SplitName = flag("split") ? parseSplit(flag("split")) : "validation";
const objective = parseObjective(flag("objective"));
const source = parseBenchmarkSource(flag("benchmark"));
const obj = OBJECTIVES[objective];

warnIfTestSplit(split);

const seasons = seasonsFor(split);
const allMatches = loadAllMatches();

console.log(`Walk-forward auf "${split}" (${seasons.join(", ")})`);
console.log(`Zielgroesse: ${obj.label}, Messlatte: ${BENCHMARK_LABELS[source]}\n`);

const RUN: RunSpec = { name: "modell", variant: "model" };
const MARKT: RunSpec = { name: "markt", variant: "benchmark" };

function evaluate(contexts: SeasonContexts[]): { values: number[]; summary: MetricSummary } {
  const evaluations = evaluateRun(contexts, RUN);
  return {
    values: evaluations.map((e) => obj.pick(e) ?? NaN),
    summary: summarize(evaluations.map((e) => e.metrics)),
  };
}

// Teil 1: aendert der Aufbau ueberhaupt etwas?
//
// Beide Wege bewerten dieselben Spiele in derselben Reihenfolge -- der Vergleich ist also
// gepaart, und ein Bootstrap darauf ist zulaessig.
const boundary = buildWalkForwardOrBoundary("boundary");
const walk = buildWalkForwardOrBoundary("walk");

function buildWalkForwardOrBoundary(mode: "boundary" | "walk", options = PRODUCTION_MODEL_OPTIONS) {
  return mode === "boundary"
    ? buildContexts(seasons, options, allMatches, buildLeagueModel, source)
    : buildWalkForwardContexts(seasons, options, allMatches, buildLeagueModel, source);
}

const boundaryEval = evaluate(boundary);
const walkEval = evaluate(walk);
const marketSummary = summarize(evaluateRun(boundary, MARKT).map((e) => e.metrics));

console.log(formatSummary("Saisongrenze (bisheriger Aufbau)", boundaryEval.summary));
console.log(formatSummary("Walk-forward (Refit je Spieltag)", walkEval.summary));
console.log(formatSummary(`ZIEL (${BENCHMARK_LABELS[source]})`, marketSummary));

if (boundaryEval.values.length !== walkEval.values.length) {
  console.error(
    `\nUnterschiedliche Fallzahlen (${boundaryEval.values.length} gegen ${walkEval.values.length}) --` +
      ` der gepaarte Vergleich waere nicht gueltig. Abbruch.`
  );
  process.exit(1);
}

const gain = pairedBootstrap(
  boundaryEval.values.map((v, i) => v - walkEval.values[i])
);
console.log(
  `\nGewinn durch den Refit im Saisonverlauf: ${gain.meanDiff >= 0 ? "+" : ""}${gain.meanDiff.toFixed(4)} ` +
    `[${gain.ciLow.toFixed(4)}, ${gain.ciHigh.toFixed(4)}]  p = ${gain.pValue.toFixed(4)}`
);
console.log(
  `(positiv = Walk-forward ist besser. Ist das rund null, traegt der laufende Saisonstand\n` +
    ` unter der aktuellen Parametrisierung schlicht nichts bei -- was fuer sich genommen\n` +
    ` schon eine Antwort ist.)`
);

// Teil 2: die eigentliche Frage. Unter Walk-forward duerfen kuerzere Halbwertszeiten
// zeigen, was sie koennen -- an der Saisongrenze konnten sie es bauartbedingt nicht.
const candidates: { label: string; model: LeagueModelOptions }[] = [];
for (const halfLifeDays of [90, 180, 250, 365, 500, 700]) {
  for (const ridgePseudoMatches of [4, 8, 16]) {
    candidates.push({
      label: `${halfLifeDays}d + Ridge ${ridgePseudoMatches}`,
      model: { halfLifeDays, ridgePseudoMatches },
    });
  }
}

console.log(`\n\n=== Kandidaten unter Walk-forward ===`);
console.log(`Bezug ist die produktive Einstellung (${PRODUCTION_MODEL_OPTIONS.halfLifeDays}d + Ridge ${PRODUCTION_MODEL_OPTIONS.ridgePseudoMatches}), walk-forward gerechnet.\n`);
console.log(`Kandidat                  Wert      Δ vs produktiv        p`);
console.log("-".repeat(66));

const rows: { label: string; value: number; delta: number; p: number }[] = [];
for (const candidate of candidates) {
  const contexts = buildWalkForwardContexts(
    seasons,
    candidate.model,
    allMatches,
    buildLeagueModel,
    source
  );
  const ev = evaluate(contexts);
  const diffs = walkEval.values.map((v, i) => v - ev.values[i]);
  const boot = pairedBootstrap(diffs);
  rows.push({ label: candidate.label, value: obj.of(ev.summary), delta: boot.meanDiff, p: boot.pValue });
}

for (const r of rows.sort((a, b) => b.delta - a.delta)) {
  const isProduction =
    r.label === `${PRODUCTION_MODEL_OPTIONS.halfLifeDays}d + Ridge ${PRODUCTION_MODEL_OPTIONS.ridgePseudoMatches}`;
  console.log(
    `${r.label.padEnd(24)} ${r.value.toFixed(4)}  ${r.delta >= 0 ? "+" : ""}${r.delta.toFixed(4)}   ` +
      `${r.p.toFixed(4)}${isProduction ? "   <- produktiv" : ""}`
  );
}

console.log(
  `\nLesehilfe: ein Kandidat ist erst dann ein Argument, wenn er die produktive Einstellung\n` +
    `UNTER WALK-FORWARD schlaegt und p klein ist. Und selbst dann wird er nicht mitten in der\n` +
    `Saison eingebaut -- siehe SAISONBETRIEB.md, "Eingefroren". Aufschreiben, nach der Saison\n` +
    `umsetzen.`
);
