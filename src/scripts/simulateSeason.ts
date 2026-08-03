import { loadAllMatches, parseMatchDate } from "../data/loadMatches";
import { buildLeagueModel } from "../model/teamStrength";
import { predictMatch } from "../model/predictMatch";
import { computeXgForm, XG_FORM_WINDOW } from "../model/xgForm";

// Simuliert eine komplette Saison spieltagsweise (nur Modell, keine Wettquoten -- die lassen
// sich fuer vergangene Saisons ohnehin nicht sauber "on-the-fly" simulieren und muessen nicht
// mitoptimiert werden). Ziel: sichtbar machen, wie sich die xG-Formkurve (aktuell Fenster von
// XG_FORM_WINDOW Spielen) waehrend der Saison aufbaut und ob/ab wann sie die Tendenz-Trefferquote
// spuerbar verbessert.
const allMatches = loadAllMatches();

// Neueste komplette Saison (306 Spiele) nehmen, falls kein Parameter uebergeben wird.
const seasonArg = process.argv[2];
const seasonCounts = new Map<string, number>();
for (const m of allMatches) seasonCounts.set(m.season, (seasonCounts.get(m.season) ?? 0) + 1);
const completeSeasons = [...seasonCounts.entries()].filter(([, count]) => count >= 300).map(([s]) => s);
const sortedCompleteSeasons = completeSeasons.sort();
const targetSeason = seasonArg ?? sortedCompleteSeasons[sortedCompleteSeasons.length - 1];

if (!targetSeason) {
  console.error("Keine vollstaendige Saison gefunden.");
  process.exit(1);
}

console.log(`Simuliere Saison ${targetSeason} (xG-Formfenster: ${XG_FORM_WINDOW} Spiele, ohne Wettquoten)\n`);

const trainMatches = allMatches.filter((m) => m.season < targetSeason);
const seasonMatches = allMatches
  .filter((m) => m.season === targetSeason)
  .sort((a, b) => parseMatchDate(a.date).getTime() - parseMatchDate(b.date).getTime());

const model = buildLeagueModel(trainMatches);

// Bundesliga = 18 Teams = 9 Spiele/Spieltag. Kein offizielles Matchday-Feld in den CSVs,
// daher chronologisch in 9er-Bloecke gruppiert (bei Nachholspielen nur eine grobe Annaeherung).
const MATCHES_PER_MATCHDAY = 9;
const matchdays: (typeof seasonMatches)[] = [];
for (let i = 0; i < seasonMatches.length; i += MATCHES_PER_MATCHDAY) {
  matchdays.push(seasonMatches.slice(i, i + MATCHES_PER_MATCHDAY));
}

function outcomeOf(probs: { homeWinProb: number; drawProb: number; awayWinProb: number }): "H" | "D" | "A" {
  if (probs.homeWinProb > probs.drawProb && probs.homeWinProb > probs.awayWinProb) return "H";
  if (probs.drawProb > probs.awayWinProb) return "D";
  return "A";
}

let cumulativeWithForm = 0;
let cumulativeNoForm = 0;
let cumulativeTotal = 0;

matchdays.forEach((matchday, idx) => {
  let correctWithForm = 0;
  let correctNoForm = 0;

  for (const match of matchday) {
    const matchDate = parseMatchDate(match.date);
    const homeForm = computeXgForm(match.homeTeam, matchDate);
    const awayForm = computeXgForm(match.awayTeam, matchDate);
    const withForm = predictMatch(model, match.homeTeam, match.awayTeam, homeForm, awayForm);
    const noForm = predictMatch(model, match.homeTeam, match.awayTeam, 0, 0);

    const actualOutcome =
      match.homeGoals > match.awayGoals ? "H" : match.homeGoals === match.awayGoals ? "D" : "A";
    const withFormOutcome = outcomeOf(withForm);
    const noFormOutcome = outcomeOf(noForm);
    const hitWithForm = withFormOutcome === actualOutcome;
    const hitNoForm = noFormOutcome === actualOutcome;
    if (hitWithForm) correctWithForm++;
    if (hitNoForm) correctNoForm++;

    const diff = withFormOutcome !== noFormOutcome ? ` (ohne Form: ${noFormOutcome})` : "";
    console.log(
      `  ${match.homeTeam} ${match.homeGoals}:${match.awayGoals} ${match.awayTeam}` +
        `  [Tipp ${withFormOutcome} | Form H${homeForm >= 0 ? "+" : ""}${homeForm.toFixed(2)} A${awayForm >= 0 ? "+" : ""}${awayForm.toFixed(2)}]` +
        `  ${hitWithForm ? "✓" : "✗"}${diff}`
    );
  }

  cumulativeWithForm += correctWithForm;
  cumulativeNoForm += correctNoForm;
  cumulativeTotal += matchday.length;

  console.log(
    `Spieltag ${idx + 1}: mit Form ${correctWithForm}/${matchday.length}, ohne Form ${correctNoForm}/${matchday.length}  ` +
      `(kumuliert mit Form: ${((cumulativeWithForm / cumulativeTotal) * 100).toFixed(1)}%, ` +
      `ohne Form: ${((cumulativeNoForm / cumulativeTotal) * 100).toFixed(1)}% ueber ${cumulativeTotal} Spiele)\n`
  );
});

console.log(
  `=== Endstand Saison ${targetSeason}: mit Form ${((cumulativeWithForm / cumulativeTotal) * 100).toFixed(1)}%  ` +
    `vs. ohne Form ${((cumulativeNoForm / cumulativeTotal) * 100).toFixed(1)}% ===`
);
