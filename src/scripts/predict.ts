import { readFileSync } from "fs";
import { join } from "path";
import { loadAllMatches } from "../data/loadMatches";
import { buildLeagueModel } from "../model/teamStrength";
import { predictMatch } from "../model/predictMatch";

const FIXTURES_PATH = join(__dirname, "..", "..", "data", "fixtures.json");

interface Fixture {
  homeTeam: string;
  awayTeam: string;
}

const fixtures: Fixture[] = JSON.parse(readFileSync(FIXTURES_PATH, "utf-8"));

const matches = loadAllMatches();
const model = buildLeagueModel(matches);

for (const { homeTeam, awayTeam } of fixtures) {
  const prediction = predictMatch(model, homeTeam, awayTeam);
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
