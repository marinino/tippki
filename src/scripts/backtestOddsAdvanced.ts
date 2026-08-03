import { loadAllMatches, parseMatchDate } from "../data/loadMatches";
import { buildLeagueModel } from "../model/teamStrength";
import { predictMatch } from "../model/predictMatch";
import { computeXgForm } from "../model/xgForm";
import { impliedProbabilities, blendWithMarket, logPoolWithMarket } from "../model/marketOdds";

// Verfeinerung von backtestOdds.ts: (1) ist alpha=0.5 pro Saison stabil, oder nur im Aggregat gut?
// (2) schlaegt logarithmisches Pooling (logPoolWithMarket) den linearen Blend?
const TEST_SEASONS = ["2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025"];
const ALPHAS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

const allMatches = loadAllMatches();

// Vorberechnung: pro Saison Modell-Vorhersage + Marktwahrscheinlichkeit + tatsaechliches Ergebnis,
// damit wir nicht fuer jede alpha/Methode-Kombination neu durch buildLeagueModel muessen.
interface Evaluated {
  season: string;
  prediction: ReturnType<typeof predictMatch>;
  market: ReturnType<typeof impliedProbabilities> | null;
  actual: "H" | "D" | "A";
}

const evaluated: Evaluated[] = [];

for (const testSeason of TEST_SEASONS) {
  const trainMatches = allMatches.filter((m) => m.season < testSeason);
  const testMatches = allMatches.filter((m) => m.season === testSeason);
  const model = buildLeagueModel(trainMatches);

  for (const match of testMatches) {
    const matchDate = parseMatchDate(match.date);
    const homeForm = computeXgForm(match.homeTeam, matchDate);
    const awayForm = computeXgForm(match.awayTeam, matchDate);
    const prediction = predictMatch(model, match.homeTeam, match.awayTeam, homeForm, awayForm);
    const market =
      match.oddsHome && match.oddsDraw && match.oddsAway
        ? impliedProbabilities(match.oddsHome, match.oddsDraw, match.oddsAway)
        : null;
    const actual = match.homeGoals > match.awayGoals ? "H" : match.homeGoals === match.awayGoals ? "D" : "A";

    evaluated.push({ season: testSeason, prediction, market, actual });
  }
}

function outcomeOf(probs: { homeWinProb: number; drawProb: number; awayWinProb: number }): "H" | "D" | "A" {
  if (probs.homeWinProb > probs.drawProb && probs.homeWinProb > probs.awayWinProb) return "H";
  if (probs.drawProb > probs.awayWinProb) return "D";
  return "A";
}

function accuracy(blend: (e: Evaluated, alpha: number) => { homeWinProb: number; drawProb: number; awayWinProb: number }, alpha: number): number {
  let correct = 0;
  for (const e of evaluated) {
    const probs = e.market ? blend(e, alpha) : e.prediction;
    if (outcomeOf(probs) === e.actual) correct++;
  }
  return (correct / evaluated.length) * 100;
}

console.log("=== Aggregat: linear vs. log-pool, verschiedene alpha ===");
for (const alpha of ALPHAS) {
  const linear = accuracy((e, a) => blendWithMarket(e.prediction, e.market!, a), alpha);
  const logPool = accuracy((e, a) => logPoolWithMarket(e.prediction, e.market!, a), alpha);
  console.log(`alpha=${alpha.toFixed(1)}: linear ${linear.toFixed(2)}%   log-pool ${logPool.toFixed(2)}%`);
}

console.log("\n=== Pro Saison: Tendenz-Genauigkeit bei alpha=0 (nur Modell) vs. alpha=0.5 (linear) ===");
for (const season of TEST_SEASONS) {
  const seasonMatches = evaluated.filter((e) => e.season === season);
  let correctBase = 0;
  let correctBlend = 0;
  for (const e of seasonMatches) {
    if (outcomeOf(e.prediction) === e.actual) correctBase++;
    const probs = e.market ? blendWithMarket(e.prediction, e.market, 0.5) : e.prediction;
    if (outcomeOf(probs) === e.actual) correctBlend++;
  }
  const baseAcc = (correctBase / seasonMatches.length) * 100;
  const blendAcc = (correctBlend / seasonMatches.length) * 100;
  const delta = blendAcc - baseAcc;
  console.log(
    `${season}: nur Modell ${baseAcc.toFixed(1)}%   alpha=0.5 ${blendAcc.toFixed(1)}%   Δ ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}pp`
  );
}
