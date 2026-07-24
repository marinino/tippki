import { loadAllMatches } from "../data/loadMatches";

const matches = loadAllMatches();

console.log(`Insgesamt ${matches.length} Spiele geladen.\n`);
console.log("Beispiele:");
for (const match of matches.slice(0, 5)) {
  console.log(
    `${match.date} (${match.season}) — ${match.homeTeam} ${match.homeGoals}:${match.awayGoals} ${match.awayTeam}`
  );
}
