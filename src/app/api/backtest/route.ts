import { loadAllMatches, parseMatchDate } from "../../../data/loadMatches";
import { buildLeagueModel } from "../../../model/teamStrength";
import { predictMatch } from "../../../model/predictMatch";
import { computeXgForm } from "../../../model/xgForm";

const TEST_SEASONS = ["2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025"];

export async function GET() {
  const allMatches = loadAllMatches();

  const perSeason = [];
  let totalCorrectOutcome = 0;
  let totalCorrectScore = 0;
  let totalEvaluated = 0;

  for (const testSeason of TEST_SEASONS) {
    const trainMatches = allMatches.filter((m) => m.season < testSeason);
    const testMatches = allMatches.filter((m) => m.season === testSeason);

    const model = buildLeagueModel(trainMatches);

    let correctOutcome = 0;
    let correctScore = 0;
    let evaluated = 0;

    for (const match of testMatches) {
      const matchDate = parseMatchDate(match.date);
      const homeForm = computeXgForm(match.homeTeam, matchDate);
      const awayForm = computeXgForm(match.awayTeam, matchDate);
      const prediction = predictMatch(model, match.homeTeam, match.awayTeam, homeForm, awayForm);

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

    perSeason.push({
      season: testSeason,
      trainMatchCount: trainMatches.length,
      evaluated,
      tendencyAccuracy: correctOutcome / evaluated,
      exactScoreAccuracy: correctScore / evaluated,
    });

    totalCorrectOutcome += correctOutcome;
    totalCorrectScore += correctScore;
    totalEvaluated += evaluated;
  }

  return Response.json({
    perSeason,
    totalEvaluated,
    totalTendencyAccuracy: totalCorrectOutcome / totalEvaluated,
    totalExactScoreAccuracy: totalCorrectScore / totalEvaluated,
  });
}
