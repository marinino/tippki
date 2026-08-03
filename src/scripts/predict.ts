import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadEnvLocal } from "../data/loadEnv";
import { loadAllMatches } from "../data/loadMatches";
import { buildLeagueModel } from "../model/teamStrength";
import { predictMatch } from "../model/predictMatch";
import { computeXgForm } from "../model/xgForm";
import { readOddsCache } from "../data/oddsApi";
import { averageMarketProbabilities, blendWithMarket, ODDS_BLEND_ALPHA } from "../model/marketOdds";

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

for (const { homeTeam, awayTeam, date } of fixtures) {
  const matchDate = new Date(date);
  const homeForm = computeXgForm(homeTeam, matchDate);
  const awayForm = computeXgForm(awayTeam, matchDate);
  const prediction = predictMatch(model, homeTeam, awayTeam, homeForm, awayForm);
  const homeLabel = prediction.homeIsEstimated ? `${homeTeam} (geschätzt, Aufsteiger?)` : homeTeam;
  const awayLabel = prediction.awayIsEstimated ? `${awayTeam} (geschätzt, Aufsteiger?)` : awayTeam;

  const fixtureOdds = oddsByFixture[`${homeTeam}|${awayTeam}`];
  const outcomeProbs = fixtureOdds
    ? blendWithMarket(prediction, averageMarketProbabilities(fixtureOdds.bookmakers), ODDS_BLEND_ALPHA)
    : prediction;

  console.log(`${homeLabel} vs ${awayLabel}${fixtureOdds ? " (mit Marktquoten geblendet)" : ""}`);
  console.log(
    `  erwartete Tore: ${prediction.expectedHomeGoals.toFixed(2)} : ${prediction.expectedAwayGoals.toFixed(2)}`
  );
  console.log(
    `  Sieg H: ${(outcomeProbs.homeWinProb * 100).toFixed(1)}%  Unentschieden: ${(outcomeProbs.drawProb * 100).toFixed(1)}%  Sieg A: ${(outcomeProbs.awayWinProb * 100).toFixed(1)}%`
  );
  console.log(`  Tipp: ${prediction.mostLikelyScore}\n`);
}
