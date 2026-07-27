import { readFileSync } from "fs";
import { join } from "path";
import { loadAllMatches } from "../../../data/loadMatches";
import { buildLeagueModel } from "../../../model/teamStrength";
import { predictMatch } from "../../../model/predictMatch";
import { computeXgForm } from "../../../model/xgForm";

interface Fixture {
  homeTeam: string;
  awayTeam: string;
  date: string;
  matchday: number;
}

export async function GET() {
  const fixturesPath = join(process.cwd(), "data", "fixtures.json");
  const allFixtures: Fixture[] = JSON.parse(readFileSync(fixturesPath, "utf-8"));

  const now = new Date();
  const upcoming = allFixtures.filter((f) => new Date(f.date) >= now);
  const nextMatchday = upcoming.length > 0 ? Math.min(...upcoming.map((f) => f.matchday)) : null;
  const fixtures = upcoming.filter((f) => f.matchday === nextMatchday);

  const matches = loadAllMatches();
  const model = buildLeagueModel(matches);

  const predictions = fixtures.map(({ homeTeam, awayTeam, date }) => {
    const matchDate = new Date(date);
    const homeForm = computeXgForm(homeTeam, matchDate);
    const awayForm = computeXgForm(awayTeam, matchDate);
    const prediction = predictMatch(model, homeTeam, awayTeam, homeForm, awayForm);
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
