import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadAllMatches } from "../data/loadMatches";
import { buildLeagueModel } from "../model/teamStrength";
import { predictMatch } from "../model/predictMatch";
import { computeRecentForm, sortByDate } from "../model/recentForm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = join(__dirname, "..", "..", "data", "fixtures.json");

interface Fixture {
  homeTeam: string;
  awayTeam: string;
}

const fixtures: Fixture[] = JSON.parse(readFileSync(FIXTURES_PATH, "utf-8"));

const matches = loadAllMatches();
const matchesSortedByDate = sortByDate(matches);
const model = buildLeagueModel(matches);
const now = new Date();

for (const { homeTeam, awayTeam } of fixtures) {
  const homeForm = computeRecentForm(matchesSortedByDate, homeTeam, now);
  const awayForm = computeRecentForm(matchesSortedByDate, awayTeam, now);
  const prediction = predictMatch(model, homeTeam, awayTeam, homeForm, awayForm);
  const homeLabel = prediction.homeIsEstimated ? `${homeTeam} (geschätzt, Aufsteiger?)` : homeTeam;
  const awayLabel = prediction.awayIsEstimated ? `${awayTeam} (geschätzt, Aufsteiger?)` : awayTeam;

  console.log(`${homeLabel} vs ${awayLabel}`);
  console.log(
    `  erwartete Tore: ${prediction.expectedHomeGoals.toFixed(2)} : ${prediction.expectedAwayGoals.toFixed(2)}`
  );
  console.log(
    `  Sieg H: ${(prediction.homeWinProb * 100).toFixed(1)}%  Unentschieden: ${(prediction.drawProb * 100).toFixed(1)}%  Sieg A: ${(prediction.awayWinProb * 100).toFixed(1)}%`
  );
  console.log(`  Tipp: ${prediction.mostLikelyScore}\n`);
}
