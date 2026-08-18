// Walk-forward-Backtest. Duenner Wrapper um src/eval/backtestCore.ts -- dieselbe Logik
// versorgt auch /api/backtest, damit UI und Konsole nicht auseinanderlaufen koennen.
//
//   npm run backtest
//   npm run backtest -- --split=validation
//   npm run backtest -- --split=all --baselines
//   npm run backtest -- --benchmark=marketAverageOpen

import { formatSummary } from "../eval/metrics";
import { formatBootstrap, formatMcNemar } from "../eval/significance";
import { accuracyStandardError, parseSplit, seasonsFor, warnIfTestSplit, type SplitName } from "../eval/splits";
import {
  ALL_VARIANTS,
  VARIANT_LABELS,
  buildContexts,
  compareRuns,
  runBacktest,
  type VariantName,
} from "../eval/backtestCore";
import { BENCHMARK_LABELS, parseBenchmarkSource } from "../eval/benchmarkOdds";
import { buildLeagueModel } from "../model/teamStrength";
import { loadAllMatches } from "../data/loadMatches";

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const split: SplitName = flag("split") ? parseSplit(flag("split")) : "all";
const variant = (flag("variant") ?? "model") as VariantName;
const benchmark = parseBenchmarkSource(flag("benchmark"));

if (!ALL_VARIANTS.includes(variant)) {
  console.error(`Unbekannte Variante "${variant}". Moeglich: ${ALL_VARIANTS.join(", ")}`);
  process.exit(1);
}

warnIfTestSplit(split);

const result = runBacktest({ split, variant, benchmark });

console.log(
  `Split "${split}" (${result.seasons.join(", ")}), Variante "${VARIANT_LABELS[variant]}", ` +
    `Messlatte "${BENCHMARK_LABELS[benchmark]}"\n`
);

for (const s of result.perSeason) {
  console.log(
    `Saison ${s.season} (${String(s.trainMatchCount).padStart(4)} Trainingsspiele, ` +
      `${String(s.summary.n).padStart(3)} bewertet): ` +
      `RPS ${s.summary.rps.toFixed(4)}  ` +
      `LogLoss ${s.summary.logLoss.toFixed(4)}  ` +
      `Tendenz ${(s.summary.tendencyAccuracy * 100).toFixed(1)}%`
  );
}

const se = accuracyStandardError(result.overall.n) * 100;
console.log(`\n${formatSummary("GESAMT", result.overall)}`);
console.log(
  `Standardfehler der Trefferquote bei n=${result.overall.n}: ±${se.toFixed(2)} Prozentpunkte. ` +
    `Unterschiede darunter sind ungepaart nicht aufloesbar.`
);

const skipped = result.totalMatches - result.totalEvaluated;
if (skipped > 0) {
  console.log(
    `${skipped} von ${result.totalMatches} Spielen ohne Referenzquote -- sie fallen aus dem ` +
      `Vergleich heraus, damit alle Varianten auf derselben Spielmenge laufen.`
  );
}

console.log(
  `\nZusatzmaerkte: Over/Under 2.5 auf ${result.overall.totalsN} Spielen, ` +
    `Asian Handicap auf ${result.overall.handicapN} (nur Halblinien).`
);

if (hasFlag("baselines")) {
  console.log("\n--- Varianten auf identischen Spielen ---\n");
  for (const name of ALL_VARIANTS) {
    console.log(formatSummary(VARIANT_LABELS[name], result.baselines[name]));
  }

  const contexts = buildContexts(
    seasonsFor(split),
    {},
    loadAllMatches(),
    buildLeagueModel,
    benchmark
  );
  const pairs: [VariantName, VariantName][] = [
    ["model", "benchmark"],
    ["model", "baseRate"],
    ["benchmark", "baseRate"],
  ];

  console.log("\n--- Gepaarte Tests (A gegen B, positiv = A besser) ---\n");
  for (const [a, b] of pairs) {
    const c = compareRuns(contexts, { name: a, variant: a }, { name: b, variant: b });
    console.log(`${VARIANT_LABELS[a]} vs ${VARIANT_LABELS[b]}  (n = ${c.n})`);
    console.log(`  ${formatMcNemar("Tendenz (McNemar)", c.tendency)}`);
    console.log(`  ${formatBootstrap("RPS", c.rps)}`);
    console.log(`  ${formatBootstrap("LogLoss", c.logLoss)}`);
    if (c.totalsLogLoss) console.log(`  ${formatBootstrap("O/U 2.5 LogLoss", c.totalsLogLoss)}`);
    if (c.handicapLogLoss) console.log(`  ${formatBootstrap("AH LogLoss", c.handicapLogLoss)}`);
    if (c.scoreLogLoss) console.log(`  ${formatBootstrap("Correct Score", c.scoreLogLoss)}`);
    console.log("");
  }
}

console.log(
  `\nDie Zahl, auf die es ankommt, ist der Abstand zum Buchmacher -- nicht der absolute\n` +
    `RPS. Wie viel von einem Fussballspiel ueberhaupt vorhersagbar ist, weiss niemand;\n` +
    `wie gut die schaerfste oeffentliche Schaetzung ist, sieht man in der Zeile darueber.`
);
