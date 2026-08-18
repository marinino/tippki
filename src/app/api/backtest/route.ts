// Duenner Wrapper um src/eval/backtestCore.ts. Bis hierher war die gesamte
// Backtest-Logik aus src/scripts/backtest.ts kopiert -- zwei Kopien, die zwangslaeufig
// irgendwann verschiedene Zahlen geliefert haetten.

import {
  buildContexts,
  evaluateRun,
  runBacktest,
  type VariantName,
} from "../../../eval/backtestCore";
import { calibrationBins } from "../../../eval/calibration";
import { BENCHMARK_LABELS, parseBenchmarkSource } from "../../../eval/benchmarkOdds";
import { parseSplit, seasonsFor } from "../../../eval/splits";
import { loadAllMatches } from "../../../data/loadMatches";
import { buildLeagueModel } from "../../../model/teamStrength";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const split = params.get("split") ? parseSplit(params.get("split")) : "all";
  const variant = (params.get("variant") ?? "model") as VariantName;
  const benchmark = parseBenchmarkSource(params.get("benchmark"));

  // includeEvaluations kostet keine zusaetzliche Rechenzeit -- die Auswertungen entstehen
  // ohnehin, sie wurden bisher nur verworfen. Ueber die Leitung gehen davon nur die zehn
  // Klassen des Reliability-Diagramms, nicht die 2448 Spiele.
  const result = runBacktest({ split, variant, benchmark, includeEvaluations: true });
  const calibration = calibrationBins(
    result.evaluations.map((e) => ({ probs: e.probs, actual: e.actual }))
  );

  // Die Kalibrierung der Messlatte auf denselben Spielen. Ohne sie sieht man zwar, dass
  // das Modell in einer Klasse danebenliegt, aber nicht, ob der Markt es dort besser
  // macht -- und genau das ist die Frage.
  const contexts = buildContexts(
    seasonsFor(split),
    {},
    loadAllMatches(),
    buildLeagueModel,
    benchmark
  );
  const benchmarkRun = evaluateRun(contexts, { name: "benchmark", variant: "benchmark" });
  const benchmarkCalibration = calibrationBins(
    benchmarkRun.map((e) => ({ probs: e.probs, actual: e.actual }))
  );

  return Response.json({
    split,
    variant,
    benchmark,
    benchmarkLabel: BENCHMARK_LABELS[benchmark],
    perSeason: result.perSeason.map((s) => ({
      season: s.season,
      trainMatchCount: s.trainMatchCount,
      evaluated: s.summary.n,
      tendencyAccuracy: s.summary.tendencyAccuracy,
      rps: s.summary.rps,
      logLoss: s.summary.logLoss,
    })),
    totalMatches: result.totalMatches,
    totalEvaluated: result.totalEvaluated,
    overall: result.overall,
    baselines: result.baselines,
    calibration,
    benchmarkCalibration,
  });
}
