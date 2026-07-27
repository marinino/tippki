import { loadAllMatches, parseMatchDate } from "../data/loadMatches";
import { buildLeagueModel } from "../model/teamStrength";
import { predictMatch } from "../model/predictMatch";
import { computeXgForm } from "../model/xgForm";

// Nur Saisons, vor denen es genug Trainingsdaten gibt (mind. 4 vorherige Saisons).
const TEST_SEASONS = ["2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025"];

const allMatches = loadAllMatches();

let totalCorrectOutcome = 0;
let totalCorrectScore = 0;
let totalEvaluated = 0;

for (const testSeason of TEST_SEASONS) {
  // Nur echt vorherige Saisons zum Trainieren nutzen, keine Zukunftsinformation.
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

  console.log(
    `Saison ${testSeason} (${trainMatches.length} Trainingsspiele, ${evaluated} Testspiele): ` +
      `Tendenz ${((correctOutcome / evaluated) * 100).toFixed(1)}%  ` +
      `Exakt ${((correctScore / evaluated) * 100).toFixed(1)}%`
  );

  totalCorrectOutcome += correctOutcome;
  totalCorrectScore += correctScore;
  totalEvaluated += evaluated;
}

console.log(
  `\nGesamt über ${TEST_SEASONS.length} Saisons (${totalEvaluated} Spiele): ` +
    `Tendenz ${((totalCorrectOutcome / totalEvaluated) * 100).toFixed(1)}%  ` +
    `Exakt ${((totalCorrectScore / totalEvaluated) * 100).toFixed(1)}%`
);
console.log(`Zum Vergleich: reines Raten der Tendenz läge bei ca. 33%.`);
