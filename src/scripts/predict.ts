import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadEnvLocal } from "../data/loadEnv";
import { loadAllMatches } from "../data/loadMatches";
import { buildLeagueModel } from "../model/teamStrength";
import { predictPipeline } from "../model/predictPipeline";
import { computeXgForm } from "../model/xgForm";
import { readOddsCache } from "../data/oddsApi";
import { averageMarketProbabilities } from "../model/marketOdds";
import { resolveScheme } from "../eval/scoringScheme";

loadEnvLocal();

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = join(__dirname, "..", "..", "data", "fixtures.json");

interface Fixture {
  homeTeam: string;
  awayTeam: string;
  date: string;
  matchday: number;
}

const allFixtures: Fixture[] = JSON.parse(readFileSync(FIXTURES_PATH, "utf-8"));

const now = new Date();
const upcoming = allFixtures.filter((f) => new Date(f.date) >= now);
const nextMatchday = upcoming.length > 0 ? Math.min(...upcoming.map((f) => f.matchday)) : null;
const fixtures = upcoming.filter((f) => f.matchday === nextMatchday);

const matches = loadAllMatches();
const model = buildLeagueModel(matches);

// Liest nur den zuletzt manuell aktualisierten Quoten-Cache (npm run refresh-odds), holt keine
// neuen Quoten -- damit laesst sich dieses Script beliebig oft aufrufen, ohne API-Kontingent
// zu verbrauchen.
const oddsCache = readOddsCache();
const oddsByFixture = oddsCache && oddsCache.matchday === nextMatchday ? oddsCache.odds : {};

const schemeFlag = process.argv.find((a) => a.startsWith("--scheme="))?.slice(9);
const scheme = resolveScheme(schemeFlag);

console.log(`Punkteschema: ${scheme.label}\n`);

for (const { homeTeam, awayTeam, date } of fixtures) {
  const matchDate = new Date(date);
  const fixtureOdds = oddsByFixture[`${homeTeam}|${awayTeam}`];

  const out = predictPipeline({
    model,
    homeTeam,
    awayTeam,
    homeForm: computeXgForm(homeTeam, matchDate),
    awayForm: computeXgForm(awayTeam, matchDate),
    market1x2: fixtureOdds ? averageMarketProbabilities(fixtureOdds.bookmakers) : null,
    marketTotals: fixtureOdds?.totals ?? null,
    marketSpread: fixtureOdds?.spread ?? null,
    scheme,
  });

  const homeLabel = out.homeIsEstimated ? `${homeTeam} (geschätzt, Aufsteiger?)` : homeTeam;
  const awayLabel = out.awayIsEstimated ? `${awayTeam} (geschätzt, Aufsteiger?)` : awayTeam;

  console.log(`${homeLabel} vs ${awayLabel}${out.marketApplied ? " (mit Marktquoten geblendet)" : ""}`);
  console.log(
    `  erwartete Tore: ${out.expectedHomeGoals.toFixed(2)} : ${out.expectedAwayGoals.toFixed(2)}` +
      (out.marketConstraints.length > 0
        ? `  (Modell allein: ${out.modelLambdaHome.toFixed(2)} : ${out.modelLambdaAway.toFixed(2)})`
        : "")
  );
  if (out.marketConstraints.length > 0) {
    console.log(`  Marktbedingungen: ${out.marketConstraints.join(", ")}`);
  }
  console.log(
    `  Sieg H: ${(out.finalProbs.homeWinProb * 100).toFixed(1)}%  Unentschieden: ${(out.finalProbs.drawProb * 100).toFixed(1)}%  Sieg A: ${(out.finalProbs.awayWinProb * 100).toFixed(1)}%`
  );
  console.log(
    `  Tipp: ${out.tip.tip}  (EV ${out.tip.expectedPoints.toFixed(3)} Pkt)  ` +
      `Alternative: ${out.tip.runnerUpTip} (${out.tip.runnerUpExpectedPoints.toFixed(3)})  ` +
      `wahrscheinlichstes Ergebnis: ${out.tip.argmaxCellTip}\n`
  );
}
