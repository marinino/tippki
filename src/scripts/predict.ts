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
  if (!model.teams.has(homeTeam) || !model.teams.has(awayTeam)) {
    console.log(
      `${homeTeam} vs ${awayTeam}\n  -> übersprungen: keine historischen Daten für ${!model.teams.has(homeTeam) ? homeTeam : awayTeam} (z.B. gerade aufgestiegen)\n`
    );
    continue;
  }

  const prediction = predictMatch(model, homeTeam, awayTeam);
  console.log(`${homeTeam} vs ${awayTeam}`);
  console.log(
    `  erwartete Tore: ${prediction.expectedHomeGoals.toFixed(2)} : ${prediction.expectedAwayGoals.toFixed(2)}`
  );
  console.log(
    `  Sieg H: ${(prediction.homeWinProb * 100).toFixed(1)}%  Unentschieden: ${(prediction.drawProb * 100).toFixed(1)}%  Sieg A: ${(prediction.awayWinProb * 100).toFixed(1)}%`
  );
  console.log(`  Tipp: ${prediction.mostLikelyScore}\n`);
}
