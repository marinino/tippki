import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadAllMatches } from "../data/loadMatches";
import { buildLeagueModel } from "../model/teamStrength";
import { predictMatch } from "../model/predictMatch";
import { computeXgForm } from "../model/xgForm";

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

for (const { homeTeam, awayTeam, date } of fixtures) {
  const matchDate = new Date(date);
  const homeForm = computeXgForm(homeTeam, matchDate);
  const awayForm = computeXgForm(awayTeam, matchDate);
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
