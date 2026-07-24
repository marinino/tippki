import { readFileSync } from "fs";
import { join } from "path";
import { loadAllMatches } from "../../../data/loadMatches";
import { buildLeagueModel } from "../../../model/teamStrength";
import { predictMatch } from "../../../model/predictMatch";

interface Fixture {
  homeTeam: string;
  awayTeam: string;
}

export async function GET() {
  const fixturesPath = join(process.cwd(), "data", "fixtures.json");
  const fixtures: Fixture[] = JSON.parse(readFileSync(fixturesPath, "utf-8"));

  const matches = loadAllMatches();
  const model = buildLeagueModel(matches);

  const predictions = fixtures.map(({ homeTeam, awayTeam }) => {
    const prediction = predictMatch(model, homeTeam, awayTeam);
    return {
      homeTeam,
      awayTeam,
      expectedHomeGoals: prediction.expectedHomeGoals,
      expectedAwayGoals: prediction.expectedAwayGoals,
      homeWinProb: prediction.homeWinProb,
      drawProb: prediction.drawProb,
      awayWinProb: prediction.awayWinProb,
      mostLikelyScore: prediction.mostLikelyScore,
      homeIsEstimated: prediction.homeIsEstimated,
      awayIsEstimated: prediction.awayIsEstimated,
    };
  });

  return Response.json({ predictions });
}
