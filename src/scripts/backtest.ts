// Walk-forward-Backtest. Duenner Wrapper um src/eval/backtestCore.ts -- dieselbe Logik
// versorgt auch /api/backtest, damit UI und Konsole nicht auseinanderlaufen koennen.
//
//   npm run backtest
//   npm run backtest -- --split=validation
//   npm run backtest -- --split=all --baselines
//   npm run backtest -- --variant=blended --scheme=kicktipp321

import { formatSummary } from "../eval/metrics";
import { formatBootstrap, formatMcNemar } from "../eval/significance";
import { resolveScheme, SCORING_SCHEMES } from "../eval/scoringScheme";
import { accuracyStandardError, parseSplit, warnIfTestSplit, type SplitName } from "../eval/splits";
import {
  ALL_VARIANTS,
  buildContexts,
  compareRuns,
  runBacktest,
  type TipMode,
  type VariantName,
} from "../eval/backtestCore";
import { seasonsFor } from "../eval/splits";

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

// Ohne --split bleibt es bei allen acht Saisons, damit der Standardaufruf weiterhin die
// historisch berichteten Zahlen liefert.
const split: SplitName = flag("split") ? parseSplit(flag("split")) : "all";
const variant = (flag("variant") ?? "modelOnly") as VariantName;
const tipMode = (flag("tip") ?? "argmaxLegacy") as TipMode;
const scheme = resolveScheme(flag("scheme"));

if (!ALL_VARIANTS.includes(variant)) {
  console.error(`Unbekannte Variante "${variant}". Moeglich: ${ALL_VARIANTS.join(", ")}`);
  process.exit(1);
}

warnIfTestSplit(split);

const result = runBacktest({ split, variant, tipMode, scheme });

console.log(
  `Split "${split}" (${result.seasons.join(", ")}), Variante "${variant}", ` +
    `Tipp "${tipMode}", Punkteschema "${scheme.label}"\n`
);

for (const s of result.perSeason) {
  console.log(
    `Saison ${s.season} (${String(s.trainMatchCount).padStart(4)} Trainingsspiele, ` +
      `${s.summary.n} Testspiele): ` +
      `Tendenz ${(s.summary.tendencyAccuracy * 100).toFixed(1)}%  ` +
      `Exakt ${(s.summary.exactScoreRate * 100).toFixed(1)}%  ` +
      `Pkt/Spiel ${s.summary.pointsPerMatch.toFixed(3)}  ` +
      `RPS ${s.summary.rps.toFixed(4)}`
  );
}

const se = accuracyStandardError(result.overall.n) * 100;
console.log(
  `\nGesamt über ${result.seasons.length} Saisons (${result.overall.n} Spiele): ` +
    `Tendenz ${(result.overall.tendencyAccuracy * 100).toFixed(1)}%  ` +
    `Exakt ${(result.overall.exactScoreRate * 100).toFixed(1)}%  ` +
    `Pkt/Spiel ${result.overall.pointsPerMatch.toFixed(3)}  ` +
    `RPS ${result.overall.rps.toFixed(4)}`
);
console.log(
  `Standardfehler der Trefferquote bei n=${result.overall.n}: ±${se.toFixed(2)} Prozentpunkte. ` +
    `Unterschiede darunter sind ungepaart nicht aufloesbar.`
);

if (result.matchesWithoutOdds > 0) {
  console.log(
    `Hinweis: ${result.matchesWithoutOdds} von ${result.totalEvaluated} Spielen haben keine ` +
      `Quoten; marktbasierte Varianten fallen dort auf das Modell zurueck.`
  );
}

if (hasFlag("baselines")) {
  console.log("\n--- Baselines (identische Spiele, identischer Tipp) ---\n");
  for (const name of ALL_VARIANTS) {
    console.log(formatSummary(name, result.baselines[name]));
  }

  console.log(
    "\nDer Tipp ist in dieser Phase immer der Argmax der Modell-Matrix. Punkte und\n" +
      "Exaktquote sind deshalb ueber alle Varianten identisch -- vergleichbar sind hier\n" +
      "nur Tendenz, RPS, LogLoss und Brier.\n"
  );

  const contexts = buildContexts(seasonsFor(split));
  const pairs: [VariantName, VariantName][] = [
    ["blended", "modelOnly"],
    ["blended", "pureMarket"],
    ["pureMarket", "modelOnly"],
    ["modelOnly", "baseRate"],
  ];

  console.log("--- Gepaarte Tests (A gegen B, positiv = A besser) ---\n");
  for (const [a, b] of pairs) {
    const c = compareRuns(
      contexts,
      { name: a, variant: a, tipMode },
      { name: b, variant: b, tipMode },
      scheme
    );
    console.log(`${a} vs ${b}`);
    console.log(`  ${formatMcNemar("Tendenz (McNemar)", c.tendency)}`);
    console.log(`  ${formatBootstrap("RPS (Bootstrap)", c.rps)}`);
    console.log("");
  }
}

console.log(`Zum Vergleich: reines Raten der Tendenz läge bei ca. 33%.`);
console.log(`Verfuegbare Punkteschemata: ${Object.keys(SCORING_SCHEMES).join(", ")}`);
