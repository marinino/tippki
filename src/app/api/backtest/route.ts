// Duenner Wrapper um src/eval/backtestCore.ts. Bis hierher war die gesamte
// Backtest-Logik aus src/scripts/backtest.ts kopiert -- zwei Kopien, die zwangslaeufig
// irgendwann verschiedene Zahlen geliefert haetten.

import { runBacktest, type TipMode, type VariantName } from "../../../eval/backtestCore";
import { resolveScheme } from "../../../eval/scoringScheme";
import { parseSplit } from "../../../eval/splits";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const split = params.get("split") ? parseSplit(params.get("split")) : "all";
  const variant = (params.get("variant") ?? "blended") as VariantName;
  const tipMode = (params.get("tip") ?? "ev") as TipMode;
  const scheme = resolveScheme(params.get("scheme"));

  const result = runBacktest({ split, variant, tipMode, scheme });

  return Response.json({
    // Bestehende Felder unveraendert, damit das Frontend nicht bricht.
    perSeason: result.perSeason.map((s) => ({
      season: s.season,
      trainMatchCount: s.trainMatchCount,
      evaluated: s.summary.n,
      tendencyAccuracy: s.summary.tendencyAccuracy,
      exactScoreAccuracy: s.summary.exactScoreRate,
      pointsPerMatch: s.summary.pointsPerMatch,
      rps: s.summary.rps,
    })),
    totalEvaluated: result.totalEvaluated,
    totalTendencyAccuracy: result.overall.tendencyAccuracy,
    totalExactScoreAccuracy: result.overall.exactScoreRate,
    // Neu
    split,
    variant,
    tipMode,
    scheme: result.scheme.key,
    schemeLabel: result.scheme.label,
    overall: result.overall,
    baselines: result.baselines,
    matchesWithoutOdds: result.matchesWithoutOdds,
  });
}
