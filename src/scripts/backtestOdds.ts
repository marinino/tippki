import { loadAllMatches, parseMatchDate } from "../data/loadMatches";
import { buildLeagueModel } from "../model/teamStrength";
import { predictMatch } from "../model/predictMatch";
import { computeXgForm } from "../model/xgForm";
import { impliedProbabilities, blendWithMarket } from "../model/marketOdds";

// Experiment: verbessert das Einmischen der Bet365-Marktquoten (via blendWithMarket) die
// Tendenz-Trefferquote gegenueber dem reinen Modell? alpha=0 muss exakt dem bestehenden
// backtest.ts-Ergebnis entsprechen (Sanity-Check).
const TEST_SEASONS = ["2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025"];
const ALPHAS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

const allMatches = loadAllMatches();

for (const alpha of ALPHAS) {
  let totalCorrect = 0;
  let totalEvaluated = 0;
  let totalWithOdds = 0;

  for (const testSeason of TEST_SEASONS) {
    const trainMatches = allMatches.filter((m) => m.season < testSeason);
    const testMatches = allMatches.filter((m) => m.season === testSeason);
    const model = buildLeagueModel(trainMatches);

    for (const match of testMatches) {
      const matchDate = parseMatchDate(match.date);
      const homeForm = computeXgForm(match.homeTeam, matchDate);
      const awayForm = computeXgForm(match.awayTeam, matchDate);
      const prediction = predictMatch(model, match.homeTeam, match.awayTeam, homeForm, awayForm);

      let probs: { homeWinProb: number; drawProb: number; awayWinProb: number } = prediction;
      if (match.oddsHome && match.oddsDraw && match.oddsAway) {
        totalWithOdds++;
        const market = impliedProbabilities(match.oddsHome, match.oddsDraw, match.oddsAway);
        probs = blendWithMarket(prediction, market, alpha);
      }

      const actualOutcome =
        match.homeGoals > match.awayGoals ? "H" : match.homeGoals === match.awayGoals ? "D" : "A";
      const predictedOutcome =
        probs.homeWinProb > probs.drawProb && probs.homeWinProb > probs.awayWinProb
          ? "H"
          : probs.drawProb > probs.awayWinProb
            ? "D"
            : "A";

      if (predictedOutcome === actualOutcome) totalCorrect++;
      totalEvaluated++;
    }
  }

  console.log(
    `alpha=${alpha.toFixed(1)}: Tendenz ${((totalCorrect / totalEvaluated) * 100).toFixed(2)}% ` +
      `(${totalEvaluated} Spiele, ${totalWithOdds} mit Quoten)`
  );
}
