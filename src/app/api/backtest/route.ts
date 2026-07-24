import { loadAllMatches } from "../../../data/loadMatches";
import { buildLeagueModel } from "../../../model/teamStrength";
import { predictMatch } from "../../../model/predictMatch";

const TEST_SEASON = "2526";

export async function GET() {
  const allMatches = loadAllMatches();
  const trainMatches = allMatches.filter((m) => m.season !== TEST_SEASON);
  const testMatches = allMatches.filter((m) => m.season === TEST_SEASON);

  const model = buildLeagueModel(trainMatches);

  let correctOutcome = 0;
  let correctScore = 0;
  let evaluated = 0;

  for (const match of testMatches) {
    const prediction = predictMatch(model, match.homeTeam, match.awayTeam);

    const actualOutcome =
      match.homeGoals > match.awayGoals ? "H" : match.homeGoals === match.awayGoals ? "D" : "A";
    const predictedOutcome =
      prediction.homeWinProb > prediction.drawProb && prediction.homeWinProb > prediction.awayWinProb
        ? "H"
        : prediction.drawProb > prediction.awayWinProb
          ? "D"
          : "A";

    if (predictedOutcome === actualOutcome) correctOutcome++;
    if (prediction.mostLikelyScore === `${match.homeGoals}:${match.awayGoals}`) correctScore++;
    evaluated++;
  }

  return Response.json({
    testSeason: TEST_SEASON,
    trainMatchCount: trainMatches.length,
    evaluated,
    correctOutcome,
    correctScore,
    tendencyAccuracy: correctOutcome / evaluated,
    exactScoreAccuracy: correctScore / evaluated,
  });
}
