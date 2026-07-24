import { loadAllMatches } from "../data/loadMatches";
import { buildLeagueModel } from "../model/teamStrength";
import { predictMatch } from "../model/predictMatch";

const TEST_SEASON = "2526";

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

console.log(`Trainingsdaten: ${trainMatches.length} Spiele (alle Saisons außer ${TEST_SEASON})`);
console.log(`Testdaten: ${evaluated} Spiele (Saison ${TEST_SEASON})\n`);
console.log(
  `Trefferquote Tendenz (H/U/A): ${correctOutcome}/${evaluated} = ${((correctOutcome / evaluated) * 100).toFixed(1)}%`
);
console.log(
  `Trefferquote exaktes Ergebnis: ${correctScore}/${evaluated} = ${((correctScore / evaluated) * 100).toFixed(1)}%`
);
console.log(`\nZum Vergleich: reines Raten der Tendenz läge bei ca. 33%.`);
