// Ersatz fuer das fehlende Testframework: node:assert/strict plus ein tsx-Skript.
// Deckt die Stellen ab, an denen ein Fehler still bleibt und trotzdem alle Zahlen
// verschiebt -- vor allem die Unentschieden-Falle im Punkteschema.
//
//   npm run check

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseCsv } from "csv-parse/sync";
import { writeCsvMerged } from "../data/refreshResults";
import { loadAllMatches, parseMatchDate, deriveSeasonFromDate } from "../data/loadMatches";
import { OUR_NAME_TO_UNDERSTAT } from "../data/understatTeamNames";
import { XG_FORM_WINDOW, computeXgForm, computeXgFormResidual } from "../model/xgForm";
import { predictFromLambdas } from "../model/predictMatch";
import { buildLeagueModel, exponentialTimeWeights, fitPoissonModel } from "../model/teamStrength";
import { lookupMatchXg } from "../model/xgLookup";
import { predictPipeline } from "../model/predictPipeline";
import { aggregateFactors, toLambdaExponents } from "../llm/factMapping";
import {
  DEFAULT_LLM_MAX_LOG_ADJUSTMENT,
  applyWithGuardrails,
  outcomeProbsOf,
  toLlmAdjustment,
} from "../llm/llmAdjustment";
import {
  isValidMatchContext,
  isValidMatchdayContext,
  type LlmKeyFactor,
  type LlmMatchContext,
} from "../llm/matchContext";
import { SEARCH_USD_PER_REQUEST, estimateCostUsd, resolveModelProfile } from "../llm/modelProfile";
import {
  argmaxCell,
  buildDixonColesMatrix,
  outcomeMasses,
  reweightToOutcomeMasses,
  scoreProb,
  toScoreMap,
} from "../model/scoreMatrix";
import { expectedPointsForTip, selectEvTip } from "../model/tipSelector";
import {
  applyConstraints,
  constraintMasses,
  devigTwoWay,
  goalDifferenceConstraint,
  outcomeConstraint,
  totalGoalsConstraint,
  totalGoalsMarginal,
  totalOverConstraint,
} from "../model/marketConstraints";
import {
  argmaxOutcome,
  brierScore,
  logLoss,
  outcomeOf,
  rankedProbabilityScore,
  summarize,
  type OutcomeProbs,
  type PerMatchMetrics,
} from "../eval/metrics";
import { mcnemarExact, mulberry32, pairedBootstrap } from "../eval/significance";
import { SCORING_SCHEMES, pointsFor, resolveScheme } from "../eval/scoringScheme";
import { accuracyStandardError, seasonsFor } from "../eval/splits";

let sectionCount = 0;
let checkCount = 0;

function section(name: string, body: () => void): void {
  sectionCount++;
  const before = checkCount;
  body();
  console.log(`  ✓ ${name.padEnd(38)} ${checkCount - before} Checks`);
}

function check(fn: () => void): void {
  checkCount++;
  fn();
}

function closeTo(actual: number, expected: number, tolerance: number, message: string): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: ${actual} weicht um mehr als ${tolerance} von ${expected} ab`
  );
}

// ---------------------------------------------------------------------------

section("Punkteschema (Unentschieden-Falle)", () => {
  const s = SCORING_SCHEMES.kicktipp432;

  // Der Kern: ein Unentschieden-Tipp auf ein anderes Unentschieden hat zwar dieselbe
  // Tordifferenz, darf aber trotzdem nur die Tendenz-Punktzahl geben.
  check(() => assert.equal(pointsFor(1, 1, 2, 2, s), 2, "1:1 auf 2:2 muss 2 geben, nicht 3"));
  check(() => assert.equal(pointsFor(0, 0, 3, 3, s), 2, "0:0 auf 3:3 muss 2 geben, nicht 3"));
  check(() => assert.equal(pointsFor(1, 1, 1, 1, s), 4, "1:1 auf 1:1 ist exakt"));

  // Nicht-Unentschieden: die Tordifferenz-Stufe greift wie erwartet.
  check(() => assert.equal(pointsFor(2, 1, 2, 1, s), 4, "exakt"));
  check(() => assert.equal(pointsFor(2, 1, 3, 2, s), 3, "gleiche Differenz +1"));
  check(() => assert.equal(pointsFor(2, 1, 1, 0, s), 3, "gleiche Differenz +1"));
  check(() => assert.equal(pointsFor(2, 1, 4, 0, s), 2, "nur Tendenz"));
  check(() => assert.equal(pointsFor(2, 1, 0, 1, s), 0, "falsche Tendenz"));
  check(() => assert.equal(pointsFor(1, 1, 2, 0, s), 0, "Remis getippt, Heimsieg real"));
  check(() => assert.equal(pointsFor(2, 0, 1, 1, s), 0, "Heimsieg getippt, Remis real"));

  // Auswaertsseite spiegelbildlich.
  check(() => assert.equal(pointsFor(0, 2, 1, 3, s), 3, "Auswaerts, gleiche Differenz"));
  check(() => assert.equal(pointsFor(0, 2, 0, 4, s), 2, "Auswaerts, nur Tendenz"));

  // Andere Schemata.
  const only = SCORING_SCHEMES.exactOnly;
  check(() => assert.equal(pointsFor(2, 1, 2, 1, only), 1));
  check(() => assert.equal(pointsFor(2, 1, 3, 2, only), 0));

  const tend = SCORING_SCHEMES.tendencyOnly;
  check(() => assert.equal(pointsFor(2, 1, 5, 0, tend), 1, "1/1/1: jede richtige Tendenz = 1"));
  check(() => assert.equal(pointsFor(1, 1, 3, 3, tend), 1));
  check(() => assert.equal(pointsFor(2, 1, 0, 1, tend), 0));

  check(() => assert.equal(resolveScheme(undefined).key, "kicktipp432", "Default-Schema"));
  check(() => assert.equal(resolveScheme("gibtsnicht").key, "kicktipp432", "Fallback"));
  check(() => assert.equal(resolveScheme("kicktipp321").key, "kicktipp321"));
});

// ---------------------------------------------------------------------------

section("Metriken", () => {
  check(() => assert.equal(outcomeOf(2, 1), "H"));
  check(() => assert.equal(outcomeOf(1, 1), "D"));
  check(() => assert.equal(outcomeOf(0, 3), "A"));

  // Tie-Breaking muss der alten Backtest-Logik entsprechen, sonst verschieben sich die
  // historischen Vergleichszahlen.
  check(() => assert.equal(argmaxOutcome({ homeWinProb: 0.5, drawProb: 0.3, awayWinProb: 0.2 }), "H"));
  check(() => assert.equal(argmaxOutcome({ homeWinProb: 0.2, drawProb: 0.5, awayWinProb: 0.3 }), "D"));
  check(() => assert.equal(argmaxOutcome({ homeWinProb: 0.2, drawProb: 0.3, awayWinProb: 0.5 }), "A"));
  check(() =>
    assert.equal(
      argmaxOutcome({ homeWinProb: 0.4, drawProb: 0.4, awayWinProb: 0.2 }),
      "D",
      "Bei Gleichstand H/D gewinnt D (wie bisher)"
    )
  );
  check(() =>
    assert.equal(
      argmaxOutcome({ homeWinProb: 0.2, drawProb: 0.4, awayWinProb: 0.4 }),
      "A",
      "Bei Gleichstand D/A gewinnt A (wie bisher)"
    )
  );

  const perfect: OutcomeProbs = { homeWinProb: 1, drawProb: 0, awayWinProb: 0 };
  const worst: OutcomeProbs = { homeWinProb: 0, drawProb: 0, awayWinProb: 1 };
  const nearMiss: OutcomeProbs = { homeWinProb: 0, drawProb: 1, awayWinProb: 0 };
  const uniform: OutcomeProbs = { homeWinProb: 1 / 3, drawProb: 1 / 3, awayWinProb: 1 / 3 };

  check(() => closeTo(rankedProbabilityScore(perfect, "H"), 0, 1e-12, "RPS perfekt"));
  check(() => closeTo(rankedProbabilityScore(worst, "H"), 1, 1e-12, "RPS maximal falsch"));
  check(() => closeTo(rankedProbabilityScore(uniform, "H"), 5 / 18, 1e-12, "RPS uniform"));

  // Das ist der Grund, warum RPS und nicht Brier optimiert wird: bei einem Heimsieg ist
  // "Unentschieden getippt" naeher dran als "Auswaertssieg getippt". Der RPS sieht das,
  // der Brier-Score nicht -- der bestraft beide Faelle exakt gleich.
  check(() =>
    assert.ok(
      rankedProbabilityScore(nearMiss, "H") < rankedProbabilityScore(worst, "H"),
      "RPS muss die Ordnung H < D < A beruecksichtigen"
    )
  );
  check(() =>
    closeTo(
      brierScore(nearMiss, "H"),
      brierScore(worst, "H"),
      1e-12,
      "Brier kann die beiden Faelle bauartbedingt nicht unterscheiden"
    )
  );

  check(() => closeTo(logLoss(perfect, "H"), 0, 1e-12, "LogLoss perfekt"));
  check(() => closeTo(logLoss(uniform, "H"), Math.log(3), 1e-12, "LogLoss uniform"));
  check(() => assert.ok(logLoss(worst, "H") > 30, "LogLoss bei p=0 wird gedeckelt, nicht Infinity"));
  check(() => assert.ok(Number.isFinite(logLoss(worst, "H"))));

  check(() => closeTo(brierScore(perfect, "H"), 0, 1e-12, "Brier perfekt"));
  check(() => closeTo(brierScore(uniform, "H"), 2 / 3, 1e-12, "Brier uniform"));

  // summarize
  const rows: PerMatchMetrics[] = [
    { predicted: "H", actual: "H", exactHit: true, points: 4, rps: 0.1, logLoss: 0.5, brier: 0.2 },
    { predicted: "H", actual: "A", exactHit: false, points: 0, rps: 0.5, logLoss: 1.5, brier: 1.0 },
  ];
  const s = summarize(rows);
  check(() => assert.equal(s.n, 2));
  check(() => closeTo(s.tendencyAccuracy, 0.5, 1e-12, "Trefferquote"));
  check(() => closeTo(s.exactScoreRate, 0.5, 1e-12, "Exaktquote"));
  check(() => closeTo(s.pointsPerMatch, 2, 1e-12, "Punkte/Spiel"));
  check(() => assert.equal(s.pointsTotal, 4));
  check(() => closeTo(s.rps, 0.3, 1e-12, "RPS-Mittel"));
  check(() =>
    assert.equal(
      s.expectedPointsPerMatch,
      null,
      "Ohne expectedPoints auf jeder Zeile darf kein Mittelwert entstehen"
    )
  );

  const withEv = summarize(rows.map((r) => ({ ...r, expectedPoints: 1.5 })));
  check(() => closeTo(withEv.expectedPointsPerMatch!, 1.5, 1e-12, "EV-Mittel"));

  check(() => assert.equal(summarize([]).n, 0, "Leere Eingabe darf nicht werfen"));
});

// ---------------------------------------------------------------------------

section("Signifikanztests", () => {
  // Determinismus und Wertebereich des PRNG.
  const a = mulberry32(42);
  const b = mulberry32(42);
  const drawsA = [a(), a(), a()];
  const drawsB = [b(), b(), b()];
  check(() => assert.deepEqual(drawsA, drawsB, "Gleicher Seed muss gleiche Folge liefern"));
  check(() => assert.ok(drawsA.every((x) => x >= 0 && x < 1), "PRNG-Werte in [0,1)"));
  check(() =>
    assert.notDeepEqual([mulberry32(43)(), mulberry32(44)()], [drawsA[0], drawsA[0]]),
  );

  // Hartkodierte Referenzwerte: faengt eine versehentliche Aenderung am PRNG, die sonst
  // still alle bisherigen Bootstrap-Ergebnisse unvergleichbar machen wuerde.
  check(() => closeTo(drawsA[0], 0.6011037519201636, 1e-15, "mulberry32(42) Ziehung 1"));
  check(() => closeTo(drawsA[1], 0.44829055899754167, 1e-15, "mulberry32(42) Ziehung 2"));
  check(() => closeTo(drawsA[2], 0.8524657934904099, 1e-15, "mulberry32(42) Ziehung 3"));

  // McNemar
  check(() => assert.equal(mcnemarExact(0, 0).pValue, 1, "Keine Abweichungen -> p = 1"));
  check(() => closeTo(mcnemarExact(10, 0).pValue, 0.001953125, 1e-12, "10:0 = 2 * 0.5^10"));
  check(() => closeTo(mcnemarExact(0, 10).pValue, 0.001953125, 1e-12, "Symmetrie"));
  check(() =>
    closeTo(mcnemarExact(7, 3).pValue, mcnemarExact(3, 7).pValue, 1e-15, "p(b,c) === p(c,b)")
  );
  check(() => assert.equal(mcnemarExact(5, 5).pValue, 1, "Perfekt symmetrisch -> p = 1"));
  check(() => assert.ok(mcnemarExact(1, 1).pValue <= 1, "p darf nie ueber 1 laufen"));
  // Log-Raum-Akkumulation: mit naiven Binomialkoeffizienten wuerde C(600,300) ueberlaufen.
  check(() => assert.ok(Number.isFinite(mcnemarExact(300, 300).pValue)));
  check(() => assert.equal(mcnemarExact(300, 300).pValue, 1));
  check(() => assert.ok(mcnemarExact(340, 260).pValue < 0.01, "Klarer Unterschied bei n=600"));

  // Bootstrap
  const zero = pairedBootstrap(new Array(200).fill(0), { iterations: 500 });
  check(() => assert.equal(zero.meanDiff, 0));
  check(() => assert.equal(zero.ciLow, 0));
  check(() => assert.equal(zero.ciHigh, 0));
  check(() =>
    assert.equal(zero.pValue, 1, "Identische Varianten muessen p = 1 liefern, nicht p = 0")
  );

  const strong = pairedBootstrap(new Array(200).fill(1), { iterations: 500 });
  check(() => closeTo(strong.meanDiff, 1, 1e-12, "Konstante Differenz"));
  check(() => assert.equal(strong.pValue, 0, "Konstant positiver Effekt -> p = 0"));

  const mixedRandom = mulberry32(7);
  const noise = Array.from({ length: 500 }, () => mixedRandom() - 0.5);
  const noiseResult = pairedBootstrap(noise, { iterations: 2000 });
  check(() => assert.ok(noiseResult.pValue > 0.05, "Reines Rauschen darf nicht signifikant sein"));
  check(() => assert.ok(noiseResult.ciLow < 0 && noiseResult.ciHigh > 0, "CI muss 0 enthalten"));

  const repeat1 = pairedBootstrap(noise, { iterations: 2000 });
  check(() =>
    assert.deepEqual(
      [repeat1.ciLow, repeat1.ciHigh, repeat1.pValue],
      [noiseResult.ciLow, noiseResult.ciHigh, noiseResult.pValue],
      "Gleicher Seed -> reproduzierbares Ergebnis"
    )
  );

  const empty = pairedBootstrap([], { iterations: 100 });
  check(() => assert.equal(empty.pValue, 1, "Leere Eingabe darf nicht werfen"));
  check(() => assert.equal(empty.n, 0));
});

// ---------------------------------------------------------------------------

section("Splits", () => {
  check(() => assert.equal(seasonsFor("validation").length, 5));
  check(() => assert.equal(seasonsFor("test").length, 3));
  check(() => assert.equal(seasonsFor("all").length, 8));
  check(() =>
    assert.equal(
      seasonsFor("validation").filter((s) => seasonsFor("test").includes(s)).length,
      0,
      "Validation und Test duerfen sich nicht ueberlappen"
    )
  );
  check(() =>
    assert.deepEqual(
      seasonsFor("all"),
      [...seasonsFor("validation"), ...seasonsFor("test")],
      "all = validation + test"
    )
  );

  // Die Zahl, die diesem ganzen Umbau zugrunde liegt.
  check(() =>
    closeTo(accuracyStandardError(2448), 0.0101, 5e-5, "SE der Trefferquote bei n=2448 ~ 1.01pp")
  );
  check(() =>
    closeTo(accuracyStandardError(918), 0.0165, 5e-5, "SE der Trefferquote bei n=918 ~ 1.65pp")
  );
});

// ---------------------------------------------------------------------------

section("Score-Matrix", () => {
  const m = buildDixonColesMatrix(1.7, 1.1);

  let total = 0;
  for (const c of m.cells) total += c;
  check(() => closeTo(total, 1, 1e-12, "Matrix muss auf 1 summieren"));
  check(() => assert.ok([...m.cells].every((c) => c >= 0), "keine negativen Zellen"));

  const masses = outcomeMasses(m);
  check(() =>
    closeTo(masses.homeWinProb + masses.drawProb + masses.awayWinProb, 1, 1e-12, "Massen")
  );
  check(() => assert.ok(masses.homeWinProb > masses.awayWinProb, "1.7 vs 1.1 -> Heim vorne"));

  // Aequivalenz zur bisherigen Implementierung in predictMatch.ts. Bitgenau, nicht nur
  // ungefaehr -- sonst waere nach dem Umbau nicht mehr entscheidbar, ob eine spaetere
  // Aenderung wirkt oder nur anders rundet.
  const lambdaPairs: [number, number][] = [
    [1.7, 1.1],
    [0.8, 2.4],
    [2.9, 0.4],
    [1.35, 1.35],
    [0.21, 0.19],
    [4.6, 3.1],
  ];
  for (const [lh, la] of lambdaPairs) {
    const legacy = predictFromLambdas(lh, la);
    const matrix = buildDixonColesMatrix(lh, la);
    const mm = outcomeMasses(matrix);

    check(() => assert.equal(mm.homeWinProb, legacy.homeWinProb, `Heimsieg-Masse ${lh}/${la}`));
    check(() => assert.equal(mm.drawProb, legacy.drawProb, `Remis-Masse ${lh}/${la}`));
    check(() => assert.equal(mm.awayWinProb, legacy.awayWinProb, `Auswaerts-Masse ${lh}/${la}`));
    check(() => assert.equal(argmaxCell(matrix), legacy.mostLikelyScore, `Argmax ${lh}/${la}`));

    const asMap = toScoreMap(matrix);
    for (const [score, p] of legacy.scoreProbabilities) {
      assert.equal(asMap.get(score), p, `Zelle ${score} bei ${lh}/${la}`);
    }
    checkCount += legacy.scoreProbabilities.size;
  }

  // reweightToOutcomeMasses
  const target = { homeWinProb: 0.55, drawProb: 0.25, awayWinProb: 0.2 };
  const rw = reweightToOutcomeMasses(m, target);
  const rwMasses = outcomeMasses(rw);
  check(() => closeTo(rwMasses.homeWinProb, target.homeWinProb, 1e-12, "Zielmasse Heim"));
  check(() => closeTo(rwMasses.drawProb, target.drawProb, 1e-12, "Zielmasse Remis"));
  check(() => closeTo(rwMasses.awayWinProb, target.awayWinProb, 1e-12, "Zielmasse Auswaerts"));

  let rwTotal = 0;
  for (const c of rw.cells) rwTotal += c;
  check(() => closeTo(rwTotal, 1, 1e-12, "Umgewichtete Matrix summiert auf 1"));

  // Die Form innerhalb einer Gruppe muss exakt erhalten bleiben -- das ist die
  // definierende Eigenschaft der KL-minimalen Projektion.
  check(() =>
    closeTo(
      scoreProb(rw, 2, 1) / scoreProb(rw, 3, 0),
      scoreProb(m, 2, 1) / scoreProb(m, 3, 0),
      1e-12,
      "Verhaeltnis innerhalb der Heimsieg-Gruppe unveraendert"
    )
  );
  check(() =>
    closeTo(
      scoreProb(rw, 1, 1) / scoreProb(rw, 0, 0),
      scoreProb(m, 1, 1) / scoreProb(m, 0, 0),
      1e-12,
      "Verhaeltnis innerhalb der Remis-Gruppe unveraendert"
    )
  );

  // Umgewichtung auf die eigenen Massen ist die Identitaet.
  const identity = reweightToOutcomeMasses(m, masses);
  for (let i = 0; i < m.cells.length; i++) {
    assert.ok(Math.abs(identity.cells[i] - m.cells[i]) < 1e-15, `Identitaet an Zelle ${i}`);
  }
  checkCount += m.cells.length;
});

// ---------------------------------------------------------------------------

section("EV-Tippselektor", () => {
  const rng = mulberry32(1234);

  // Zufallsmatrizen: geschlossene Form gegen die naive Doppelschleife.
  for (let trial = 0; trial < 200; trial++) {
    const lambdaHome = 0.2 + rng() * 3.5;
    const lambdaAway = 0.2 + rng() * 3.5;
    const matrix = buildDixonColesMatrix(lambdaHome, lambdaAway);
    const scheme = [
      SCORING_SCHEMES.kicktipp432,
      SCORING_SCHEMES.kicktipp321,
      SCORING_SCHEMES.exactOnly,
      SCORING_SCHEMES.tendencyOnly,
    ][trial % 4];

    const choice = selectEvTip(matrix, scheme);
    const naive = expectedPointsForTip(matrix, choice.tipHome, choice.tipAway, scheme);
    assert.ok(
      Math.abs(choice.expectedPoints - naive) < 1e-12,
      `Geschlossene Form weicht ab: ${choice.expectedPoints} vs ${naive}`
    );

    // Und der gewaehlte Tipp muss auch wirklich der beste sein.
    let bestNaive = -Infinity;
    for (let h = 0; h <= matrix.maxGoals; h++) {
      for (let a = 0; a <= matrix.maxGoals; a++) {
        bestNaive = Math.max(bestNaive, expectedPointsForTip(matrix, h, a, scheme));
      }
    }
    assert.ok(
      Math.abs(bestNaive - choice.expectedPoints) < 1e-12,
      `Nicht das Maximum gewaehlt: ${choice.expectedPoints} statt ${bestNaive}`
    );
  }
  checkCount += 400;

  // Orakel: unter 1/1/1 zaehlt nur die Tendenz, also muss der EV-Tipp dieselbe Tendenz
  // haben wie der Argmax der aggregierten Wahrscheinlichkeiten -- die alte Logik.
  const rng2 = mulberry32(99);
  for (let trial = 0; trial < 200; trial++) {
    const matrix = buildDixonColesMatrix(0.2 + rng2() * 3.5, 0.2 + rng2() * 3.5);
    const choice = selectEvTip(matrix, SCORING_SCHEMES.tendencyOnly);
    const tipOutcome = outcomeOf(choice.tipHome, choice.tipAway);
    assert.equal(
      tipOutcome,
      argmaxOutcome(outcomeMasses(matrix)),
      "Unter 1/1/1 muss der EV-Tipp der Argmax-Tendenz folgen"
    );
  }
  checkCount += 200;

  // Unter "nur exaktes Ergebnis" ist der EV-Tipp genau die Argmax-Zelle.
  const rng3 = mulberry32(7);
  for (let trial = 0; trial < 100; trial++) {
    const matrix = buildDixonColesMatrix(0.2 + rng3() * 3.5, 0.2 + rng3() * 3.5);
    const choice = selectEvTip(matrix, SCORING_SCHEMES.exactOnly);
    assert.equal(choice.tip, argmaxCell(matrix), "Unter exactOnly == Argmax-Zelle");
  }
  checkCount += 100;

  // Der EV-Tipp darf nie schlechter sein als der alte Argmax-Tipp -- das ist der ganze
  // Punkt der Umstellung, und es gilt per Konstruktion.
  const rng4 = mulberry32(555);
  for (let trial = 0; trial < 200; trial++) {
    const matrix = buildDixonColesMatrix(0.2 + rng4() * 3.5, 0.2 + rng4() * 3.5);
    const scheme = SCORING_SCHEMES.kicktipp432;
    const choice = selectEvTip(matrix, scheme);
    const [ah, aa] = choice.argmaxCellTip.split(":").map(Number);
    const argmaxEv = expectedPointsForTip(matrix, ah, aa, scheme);
    assert.ok(
      choice.expectedPoints >= argmaxEv - 1e-12,
      `EV-Tipp (${choice.expectedPoints}) schlechter als Argmax-Tipp (${argmaxEv})`
    );
  }
  checkCount += 200;

  // Runner-up muss schlechter oder gleich gut sein und ein anderer Tipp.
  const matrix = buildDixonColesMatrix(1.8, 1.0);
  const choice = selectEvTip(matrix, SCORING_SCHEMES.kicktipp432);
  check(() => assert.ok(choice.runnerUpExpectedPoints <= choice.expectedPoints));
  check(() => assert.notEqual(choice.runnerUpTip, choice.tip, "Runner-up muss abweichen"));
  check(() =>
    closeTo(
      choice.runnerUpExpectedPoints,
      expectedPointsForTip(
        matrix,
        Number(choice.runnerUpTip.split(":")[0]),
        Number(choice.runnerUpTip.split(":")[1]),
        SCORING_SCHEMES.kicktipp432
      ),
      1e-12,
      "Runner-up-EV"
    )
  );
});

// ---------------------------------------------------------------------------

section("xG-Form == Referenzimplementierung", () => {
  // computeXgForm wurde von linearen Scans auf vorberechnete, binaer durchsuchte Indizes
  // umgestellt. Gerundete Backtest-Prozente beweisen nicht, dass sich nichts geaendert hat --
  // ein Off-by-one im Formfenster kann einzelne Vorhersagen kippen, ohne die erste
  // Nachkommastelle zu bewegen. Deshalb hier der direkte Vergleich gegen die alte Logik,
  // Zeichen fuer Zeichen nachgebaut.
  interface XgMatch {
    date: string;
    homeTeam: string;
    awayTeam: string;
    homeXG: number;
    awayXG: number;
  }

  const raw = readFileSync(join(process.cwd(), "data", "xg_bundesliga.json"), "utf-8");
  const xgMatches: XgMatch[] = JSON.parse(raw);
  const sortedXg = [...xgMatches].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  const ownMatches = loadAllMatches();

  function referenceGamesPlayed(ourTeamName: string, beforeDate: Date): number {
    const season = deriveSeasonFromDate(beforeDate);
    return ownMatches.filter(
      (m) =>
        m.season === season &&
        (m.homeTeam === ourTeamName || m.awayTeam === ourTeamName) &&
        parseMatchDate(m.date) < beforeDate
    ).length;
  }

  function referenceXgForm(ourTeamName: string, beforeDate: Date): number {
    const understatName = OUR_NAME_TO_UNDERSTAT[ourTeamName];
    if (!understatName) return 0;

    const n = Math.min(referenceGamesPlayed(ourTeamName, beforeDate), XG_FORM_WINDOW);
    if (n === 0) return 0;

    const teamMatches = sortedXg.filter(
      (m) =>
        (m.homeTeam === understatName || m.awayTeam === understatName) &&
        new Date(m.date) < beforeDate
    );
    const recent = teamMatches.slice(-n);
    if (recent.length === 0) return 0;

    const totalXgDiff = recent.reduce((sum, m) => {
      const isHome = m.homeTeam === understatName;
      const xgFor = isHome ? m.homeXG : m.awayXG;
      const xgAgainst = isHome ? m.awayXG : m.homeXG;
      return sum + (xgFor - xgAgainst);
    }, 0);

    return totalXgDiff / recent.length;
  }

  // Stichprobe ueber die gesamte Historie -- die Referenz ist O(n) pro Aufruf, ein
  // Vollvergleich wuerde `npm run check` unbenutzbar langsam machen.
  const SAMPLE_STRIDE = 8;
  let compared = 0;
  let nonZero = 0;

  for (let i = 0; i < ownMatches.length; i += SAMPLE_STRIDE) {
    const m = ownMatches[i];
    const date = parseMatchDate(m.date);
    for (const team of [m.homeTeam, m.awayTeam]) {
      const expected = referenceXgForm(team, date);
      const actual = computeXgForm(team, date);
      assert.equal(
        actual,
        expected,
        `xG-Form weicht ab fuer ${team} vor ${m.date}: ${actual} statt ${expected}`
      );
      compared++;
      if (expected !== 0) nonZero++;
    }
  }

  checkCount += compared;

  // Ohne diese Absicherung koennte die Referenz durchweg 0 liefern und der Vergleich
  // waere wertlos.
  check(() => assert.ok(compared > 500, `zu wenige Vergleiche: ${compared}`));
  check(() =>
    assert.ok(nonZero > compared * 0.5, `zu wenige Formwerte ungleich 0: ${nonZero}/${compared}`)
  );

  // Die Abweichungsvariante muss den Teamstaerke-Anteil herausnehmen: gemittelt ueber
  // viele Spiele muss sie je Team deutlich naeher an 0 liegen als die rohe xG-Differenz.
  // Genau das ist ihr Zweck -- ein Team, das spielt wie immer, hat keine "Form".
  const rawByTeam = new Map<string, number[]>();
  const residualByTeam = new Map<string, number[]>();

  for (let i = 0; i < ownMatches.length; i += 3) {
    const m = ownMatches[i];
    const date = parseMatchDate(m.date);
    for (const team of [m.homeTeam, m.awayTeam]) {
      const raw = computeXgForm(team, date);
      const residual = computeXgFormResidual(team, date);
      if (raw === 0 && residual === 0) continue;
      (rawByTeam.get(team) ?? rawByTeam.set(team, []).get(team)!).push(raw);
      (residualByTeam.get(team) ?? residualByTeam.set(team, []).get(team)!).push(residual);
    }
  }

  function meanAbsTeamMean(byTeam: Map<string, number[]>): number {
    const means: number[] = [];
    for (const values of byTeam.values()) {
      if (values.length < 30) continue;
      means.push(Math.abs(values.reduce((s, v) => s + v, 0) / values.length));
    }
    return means.reduce((s, v) => s + v, 0) / means.length;
  }

  const rawBias = meanAbsTeamMean(rawByTeam);
  const residualBias = meanAbsTeamMean(residualByTeam);

  check(() =>
    assert.ok(
      residualBias < rawBias * 0.5,
      `Abweichungsvariante muss den Staerkeanteil entfernen: ${residualBias.toFixed(3)} vs ${rawBias.toFixed(3)}`
    )
  );
  check(() => assert.ok(rawBias > 0.2, `rohe Form traegt erwartungsgemaess Staerke: ${rawBias.toFixed(3)}`));
});

// ---------------------------------------------------------------------------

section("Markt-Nebenbedingungen (IPF)", () => {
  const m = buildDixonColesMatrix(1.7, 1.1);

  check(() => closeTo(devigTwoWay(2, 2), 0.5, 1e-12, "faire Zweiwegquote"));
  check(() => closeTo(devigTwoWay(1.25, 5), 0.8, 1e-12, "1.25/5.00 ohne Marge"));
  check(() =>
    closeTo(devigTwoWay(1.9, 1.9), 0.5, 1e-12, "gleiche Quoten -> 50% trotz Overround")
  );

  // Eine 1X2-Bedingung allein muss dasselbe liefern wie reweightToOutcomeMasses.
  const target = { homeWinProb: 0.55, drawProb: 0.25, awayWinProb: 0.2 };
  const viaIpf = applyConstraints(m, [outcomeConstraint(m.maxGoals, target)]);
  const viaReweight = reweightToOutcomeMasses(m, target);
  for (let i = 0; i < m.cells.length; i++) {
    assert.ok(
      Math.abs(viaIpf.matrix.cells[i] - viaReweight.cells[i]) < 1e-12,
      `IPF mit einer Bedingung muss reweightToOutcomeMasses entsprechen (Zelle ${i})`
    );
  }
  checkCount += m.cells.length;

  // Zwei Bedingungen gleichzeitig: beide muessen am Ende erfuellt sein.
  const overProb = 0.62;
  const both = applyConstraints(m, [
    outcomeConstraint(m.maxGoals, target),
    totalOverConstraint(m.maxGoals, 2.5, overProb),
  ]);
  check(() => assert.ok(both.converged, `IPF konvergiert (Abweichung ${both.maxDeviation})`));

  const masses = outcomeMasses(both.matrix);
  check(() => closeTo(masses.homeWinProb, target.homeWinProb, 1e-8, "1X2 erfuellt"));
  check(() => closeTo(masses.drawProb, target.drawProb, 1e-8, "Remis erfuellt"));

  const totalMarginal = totalGoalsMarginal(both.matrix);
  let over25 = 0;
  for (let k = 3; k < totalMarginal.length; k++) over25 += totalMarginal[k];
  check(() => closeTo(over25, overProb, 1e-8, "Over/Under gleichzeitig erfuellt"));

  let sum = 0;
  for (const c of both.matrix.cells) sum += c;
  check(() => closeTo(sum, 1, 1e-12, "Ergebnis bleibt eine Verteilung"));

  // Volle Totals-Leiter: Halblinien werden genutzt, Viertellinien verworfen.
  const ladder = [
    { line: 0.5, oddsOver: 1.006, oddsUnder: 29 },
    { line: 1.5, oddsOver: 1.071, oddsUnder: 9 },
    { line: 2.25, oddsOver: 1.16, oddsUnder: 5.25 }, // Viertellinie -> ignorieren
    { line: 2.5, oddsOver: 1.24, oddsUnder: 3.9 },
    { line: 3.5, oddsOver: 1.615, oddsUnder: 2.3 },
    { line: 4.5, oddsOver: 2.375, oddsUnder: 1.571 },
    { line: 5.5, oddsOver: 4, oddsUnder: 1.25 },
  ];
  const totalsConstraint = totalGoalsConstraint(m.maxGoals, ladder)!;
  check(() => assert.ok(totalsConstraint !== null, "Leiter ergibt eine Bedingung"));
  check(() =>
    assert.ok(totalsConstraint.name.includes("6 Linien"), `Viertellinie verworfen: ${totalsConstraint.name}`)
  );

  let targetSum = 0;
  for (const t of totalsConstraint.targets) {
    assert.ok(t >= 0, "keine negativen Zielmassen");
    targetSum += t;
  }
  checkCount += totalsConstraint.targets.length;
  check(() => closeTo(targetSum, 1, 1e-12, "Zielmassen summieren auf 1"));

  const fitted = applyConstraints(m, [totalsConstraint]);
  const fittedMasses = constraintMasses(fitted.matrix, totalsConstraint);
  for (let g = 0; g < totalsConstraint.groupCount; g++) {
    assert.ok(
      Math.abs(fittedMasses[g] - totalsConstraint.targets[g]) < 1e-8,
      `Totals-Gruppe ${g}: ${fittedMasses[g]} statt ${totalsConstraint.targets[g]}`
    );
  }
  checkCount += totalsConstraint.groupCount;

  // Spread-Leiter, Vorzeichenkonvention: hdp -1.5 heisst "Heim gewinnt mit >= 2 Toren".
  const spread = [
    { line: -2.5, oddsHome: 2.6, oddsAway: 1.475 },
    { line: -1.5, oddsHome: 1.725, oddsAway: 2.075 },
    { line: -0.5, oddsHome: 1.3, oddsAway: 3.45 },
    { line: 0.5, oddsHome: 1.105, oddsAway: 4.4 },
    { line: 1.5, oddsHome: 1.05, oddsAway: 8 },
  ];
  const diffConstraint = goalDifferenceConstraint(m.maxGoals, spread)!;
  check(() => assert.ok(diffConstraint !== null, "Spread-Leiter ergibt eine Bedingung"));

  const withDiff = applyConstraints(m, [diffConstraint]);
  const diffMasses = constraintMasses(withDiff.matrix, diffConstraint);
  for (let g = 0; g < diffConstraint.groupCount; g++) {
    assert.ok(
      Math.abs(diffMasses[g] - diffConstraint.targets[g]) < 1e-8,
      `Spread-Gruppe ${g}: ${diffMasses[g]} statt ${diffConstraint.targets[g]}`
    );
  }
  checkCount += diffConstraint.groupCount;

  // strength = 0 muss die Matrix unveraendert lassen.
  const noop = applyConstraints(m, [outcomeConstraint(m.maxGoals, target)], { strength: 0 });
  for (let i = 0; i < m.cells.length; i++) {
    assert.equal(noop.matrix.cells[i], m.cells[i], `strength=0 darf nichts aendern (Zelle ${i})`);
  }
  checkCount += m.cells.length;

  // Umgekehrt: Bedingungen, die schon erfuellt sind, duerfen nichts bewegen.
  const identity = applyConstraints(m, [outcomeConstraint(m.maxGoals, outcomeMasses(m))]);
  for (let i = 0; i < m.cells.length; i++) {
    assert.ok(
      Math.abs(identity.matrix.cells[i] - m.cells[i]) < 1e-14,
      `bereits erfuellte Bedingung ist die Identitaet (Zelle ${i})`
    );
  }
  checkCount += m.cells.length;

  // Nicht genug Halblinien -> null statt Unsinn.
  check(() =>
    assert.equal(totalGoalsConstraint(m.maxGoals, [{ line: 2.25, oddsOver: 1.16, oddsUnder: 5.25 }]), null)
  );
  check(() => assert.equal(goalDifferenceConstraint(m.maxGoals, []), null));

  // Monotonie-Korrektur: eine widerspruechliche Leiter darf keine negativen Massen erzeugen.
  const inconsistent = totalGoalsConstraint(m.maxGoals, [
    { line: 1.5, oddsOver: 2, oddsUnder: 2 }, // P(>=2) = 0.50
    { line: 2.5, oddsOver: 1.2, oddsUnder: 6 }, // P(>=3) = 0.833 -- unmoeglich hoeher
    { line: 3.5, oddsOver: 3, oddsUnder: 1.5 },
  ]);
  check(() => assert.ok(inconsistent !== null, "widerspruechliche Leiter wird geglaettet"));
  if (inconsistent) {
    for (const t of inconsistent.targets) assert.ok(t >= 0, "keine negativen Massen nach Glaettung");
    checkCount += inconsistent.targets.length;
  }
});

// ---------------------------------------------------------------------------

section("Gewichteter Fit und xG-Ziel", () => {
  const matches = loadAllMatches().filter((m) => m.season === "2022");
  const avgHome = matches.reduce((s, m) => s + m.homeGoals, 0) / matches.length;
  const avgAway = matches.reduce((s, m) => s + m.awayGoals, 0) / matches.length;

  const plain = fitPoissonModel(matches, avgHome, avgAway);
  const uniform = fitPoissonModel(matches, avgHome, avgAway, {
    weights: new Float64Array(matches.length).fill(1),
  });

  // Gleichgewichtung muss exakt dasselbe liefern wie gar keine Gewichtung, sonst ist der
  // gewichtete Pfad nicht dieselbe Rechnung.
  for (const [team, strength] of plain.teams) {
    const other = uniform.teams.get(team)!;
    assert.ok(Math.abs(strength.attack - other.attack) < 1e-12, `attack ${team}`);
    assert.ok(Math.abs(strength.defense - other.defense) < 1e-12, `defense ${team}`);
  }
  checkCount += plain.teams.size * 2;

  // Ein konstanter Gewichtsfaktor darf ebenfalls nichts aendern -- die geschlossene Form
  // ist ein Quotient, gemeinsame Faktoren kuerzen sich heraus.
  const scaled = fitPoissonModel(matches, avgHome, avgAway, {
    weights: new Float64Array(matches.length).fill(3.7),
  });
  for (const [team, strength] of plain.teams) {
    const other = scaled.teams.get(team)!;
    assert.ok(Math.abs(strength.attack - other.attack) < 1e-10, `skaliert attack ${team}`);
  }
  checkCount += plain.teams.size;

  // MLE-Identitaet: bei k = 0 muss die Summe der erwarteten Tore je Team exakt der
  // Summe der tatsaechlichen entsprechen. Das ist eine exakte Eigenschaft des Optimums
  // und faengt jeden Indexfehler sofort.
  const expectedFor = new Map<string, number>();
  const actualFor = new Map<string, number>();
  for (const m of matches) {
    const h = plain.teams.get(m.homeTeam)!;
    const a = plain.teams.get(m.awayTeam)!;
    const lambdaHome = avgHome * Math.exp(h.attack) * Math.exp(a.defense);
    const lambdaAway = avgAway * Math.exp(a.attack) * Math.exp(h.defense);
    expectedFor.set(m.homeTeam, (expectedFor.get(m.homeTeam) ?? 0) + lambdaHome);
    expectedFor.set(m.awayTeam, (expectedFor.get(m.awayTeam) ?? 0) + lambdaAway);
    actualFor.set(m.homeTeam, (actualFor.get(m.homeTeam) ?? 0) + m.homeGoals);
    actualFor.set(m.awayTeam, (actualFor.get(m.awayTeam) ?? 0) + m.awayGoals);
  }
  for (const [team, expected] of expectedFor) {
    assert.ok(
      Math.abs(expected - actualFor.get(team)!) < 1e-6,
      `MLE-Identitaet verletzt fuer ${team}: ${expected} statt ${actualFor.get(team)}`
    );
  }
  checkCount += expectedFor.size;

  check(() => assert.ok(plain.diagnostics.converged, "Fit konvergiert"));
  check(() => assert.ok(plain.diagnostics.sweeps < 200, `Sweeps: ${plain.diagnostics.sweeps}`));

  // Zeitgewichte: monoton fallend mit dem Alter, und nach genau einer Halbwertszeit halb
  // so gross.
  const weights = exponentialTimeWeights(matches, 180);
  check(() => assert.ok(Math.max(...weights) <= 1 + 1e-12, "Gewichte hoechstens 1"));
  check(() => assert.ok(Math.min(...weights) > 0, "Gewichte positiv"));

  const sorted = [...matches].map((m, i) => ({ t: parseMatchDate(m.date).getTime(), w: weights[i] }));
  sorted.sort((a, b) => a.t - b.t);
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i].w >= sorted[i - 1].w - 1e-12, "juengere Spiele duerfen nicht leichter wiegen");
  }
  checkCount += sorted.length - 1;

  // Nach genau einer Halbwertszeit muss das Gewicht auf die Haelfte fallen.
  // Toleranz 2e-3 statt 1e-6, weil parseMatchDate auf lokale Mitternacht abbildet und
  // eine Zeitumstellung im Zeitraum das Alter um eine Stunde verschiebt -- bei 180 Tagen
  // sind das rund 1.6e-4 relativ. Die geprüfte Eigenschaft ist davon unberuehrt.
  const newest = Math.max(...matches.map((m) => parseMatchDate(m.date).getTime()));
  const halfLifeAgo = new Date(newest);
  halfLifeAgo.setDate(halfLifeAgo.getDate() - 180);
  const asCsvDate = `${String(halfLifeAgo.getDate()).padStart(2, "0")}/${String(halfLifeAgo.getMonth() + 1).padStart(2, "0")}/${halfLifeAgo.getFullYear()}`;
  const single = exponentialTimeWeights([{ ...matches[0], date: asCsvDate }], 180, new Date(newest));
  check(() => closeTo(single[0], 0.5, 2e-3, "nach einer Halbwertszeit rund 0.5"));

  // xG-Abdeckung: ist sie luecken haft, verwaessert der xG-Fit still zum Tor-Fit.
  let covered = 0;
  for (const m of matches) {
    if (lookupMatchXg(m.homeTeam, m.awayTeam, parseMatchDate(m.date))) covered++;
  }
  check(() =>
    assert.ok(
      covered / matches.length > 0.95,
      `xG-Abdeckung zu gering: ${covered}/${matches.length}`
    )
  );

  // xG-Fit muss andere Staerken liefern als der Tor-Fit -- sonst greift das Ziel nicht.
  const xgFit = fitPoissonModel(matches, avgHome, avgAway, { target: "xg" });
  let maxDiff = 0;
  for (const [team, strength] of plain.teams) {
    maxDiff = Math.max(maxDiff, Math.abs(strength.attack - xgFit.teams.get(team)!.attack));
  }
  check(() => assert.ok(maxDiff > 0.02, `xG-Ziel aendert die Staerken kaum: ${maxDiff}`));

  // Blend mit Anteil 1.0 fuer echte Tore muss dem Tor-Fit entsprechen.
  const blendAllGoals = fitPoissonModel(matches, avgHome, avgAway, {
    target: "blend",
    xgBlendWeight: 1,
  });
  for (const [team, strength] of plain.teams) {
    assert.ok(
      Math.abs(strength.attack - blendAllGoals.teams.get(team)!.attack) < 1e-12,
      `Blend mit 100% Toren muss dem Tor-Fit entsprechen (${team})`
    );
  }
  checkCount += plain.teams.size;
});

// ---------------------------------------------------------------------------

section("LLM-Kontext: Mapping und Guardrails", () => {
  function factor(overrides: Partial<LlmKeyFactor> = {}): LlmKeyFactor {
    return {
      team: "home",
      category: "absence",
      subject: "Testspieler",
      role: "forward",
      importance: "key",
      direction: "weakens",
      certainty: "confirmed",
      note: "Test",
      source: "https://example.org/a",
      ...overrides,
    };
  }

  // Spieltag-Schema: ein Aufruf liefert alle neun Partien.
  check(() => assert.equal(isValidMatchdayContext(null), false));
  check(() => assert.equal(isValidMatchdayContext({ matches: "keine Liste" }), false));
  check(() => assert.equal(isValidMatchdayContext({ matches: [] }), true));
  check(() =>
    assert.equal(
      isValidMatchdayContext({
        matches: [{ homeTeam: "A", awayTeam: "B", foundAnything: false, keyFactors: [], summary: "" }],
      }),
      true
    )
  );
  check(() =>
    assert.equal(
      isValidMatchdayContext({ matches: [{ homeTeam: "A" }] }),
      false,
      "eine kaputte Partie macht den ganzen Spieltag ungueltig"
    )
  );

  // Modellprofil: die API-Oberflaeche unterscheidet sich, und ein falsches Feld ist ein
  // harter Fehler statt einer stillen Verschlechterung.
  const haiku = { ...resolveModelProfile() };
  check(() => assert.ok(haiku.model.startsWith("claude-"), `Modell-ID: ${haiku.model}`));
  check(() =>
    assert.ok(
      haiku.webSearchType === "web_search_20260209" || haiku.webSearchType === "web_search_20250305",
      "gueltiger Websuche-Typ"
    )
  );
  check(() =>
    assert.ok(
      haiku.model !== "claude-haiku-4-5" || haiku.supportsEffort === false,
      "Haiku 4.5 lehnt output_config.effort ab -- darf nicht gesetzt werden"
    )
  );
  check(() =>
    assert.ok(
      haiku.model !== "claude-haiku-4-5" || haiku.webSearchType === "web_search_20250305",
      "Haiku 4.5 kennt die dynamische Filterung nicht"
    )
  );

  // Kostenschaetzung: die Websuche ist der Kostenboden, nicht das Modell.
  const cost = estimateCostUsd(haiku, { inputTokens: 16000, outputTokens: 3000, webSearches: 8 });
  check(() => assert.ok(cost > 0 && cost < 1, `ein gebuendelter Spieltag unter 1 USD: ${cost.toFixed(3)}`));
  const searchShare =
    (8 * SEARCH_USD_PER_REQUEST) / cost;
  check(() =>
    assert.ok(
      searchShare > 0.4,
      `die Suche dominiert die Kosten (${(searchShare * 100).toFixed(0)}%) -- deshalb buendeln`
    )
  );

  // Schema-Validierung: das Modell kann trotz Structured Outputs bei einer Verweigerung
  // etwas anderes liefern, und ein halb geparster Kontext waere schlimmer als keiner.
  check(() => assert.equal(isValidMatchContext(null), false));
  check(() => assert.equal(isValidMatchContext({}), false));
  check(() => assert.equal(isValidMatchContext({ homeTeam: "A", awayTeam: "B" }), false));
  check(() =>
    assert.equal(
      isValidMatchContext({ homeTeam: "A", awayTeam: "B", foundAnything: false, keyFactors: [], summary: "" }),
      true
    )
  );
  check(() =>
    assert.equal(
      isValidMatchContext({
        homeTeam: "A",
        awayTeam: "B",
        foundAnything: true,
        summary: "",
        keyFactors: [{ ...factor(), role: "kein-gueltiger-wert" }],
      }),
      false,
      "unbekannter Enum-Wert muss abgelehnt werden"
    )
  );

  // Richtung der Wirkung. Ein fehlender Heim-Stuermer senkt die Heim-Torerwartung.
  const homeForwardOut = aggregateFactors([factor({ role: "forward" })]);
  check(() => assert.ok(homeForwardOut.homeAttack < 0, "fehlender Stuermer senkt den Angriff"));
  check(() => assert.equal(homeForwardOut.homeDefense, 0, "Stuermer wirkt nicht defensiv"));

  // Ein fehlender Auswaerts-Torhueter erhoeht die Heim-Torerwartung -- genau der Kanal,
  // der der xG-Formkurve komplett fehlt.
  const awayKeeperOut = aggregateFactors([factor({ team: "away", role: "goalkeeper" })]);
  check(() => assert.ok(awayKeeperOut.awayDefense > 0, "fehlender Torhueter erhoeht Gegentore"));
  const awayKeeperExp = toLambdaExponents(awayKeeperOut);
  check(() => assert.ok(awayKeeperExp.home > 0, "und damit die Heim-Torerwartung"));
  check(() => assert.equal(awayKeeperExp.away, 0, "die Auswaerts-Torerwartung bleibt unberuehrt"));

  // Rueckkehrer drehen das Vorzeichen.
  const returning = aggregateFactors([factor({ category: "return", direction: "strengthens" })]);
  check(() => assert.ok(returning.homeAttack > 0, "Rueckkehrer hebt den Angriff"));

  // Sicherheitsgrad und Bedeutung skalieren monoton nach unten.
  const confirmedKey = Math.abs(aggregateFactors([factor()]).homeAttack);
  const likelyKey = Math.abs(aggregateFactors([factor({ certainty: "likely" })]).homeAttack);
  const reportedKey = Math.abs(aggregateFactors([factor({ certainty: "reported" })]).homeAttack);
  check(() => assert.ok(confirmedKey > likelyKey && likelyKey > reportedKey, "Sicherheit skaliert"));

  const regular = Math.abs(aggregateFactors([factor({ importance: "regular" })]).homeAttack);
  const squad = Math.abs(aggregateFactors([factor({ importance: "squad" })]).homeAttack);
  check(() => assert.ok(confirmedKey > regular && regular > squad, "Bedeutung skaliert"));

  // Abnehmender Grenzertrag: vier fehlende Stuermer sind nicht viermal so schlimm.
  const one = Math.abs(aggregateFactors([factor()]).homeAttack);
  const four = Math.abs(
    aggregateFactors([factor(), factor({ subject: "B" }), factor({ subject: "C" }), factor({ subject: "D" })])
      .homeAttack
  );
  check(() => assert.ok(four > one, "mehr Ausfaelle wirken staerker"));
  check(() => assert.ok(four < 4 * one, `aber unterlinear: ${four.toFixed(4)} statt ${(4 * one).toFixed(4)}`));

  // Leerer Kontext = keine Korrektur.
  const empty: LlmMatchContext = {
    homeTeam: "A",
    awayTeam: "B",
    foundAnything: false,
    keyFactors: [],
    summary: "",
  };
  const noAdj = toLlmAdjustment(empty);
  check(() => assert.equal(noAdj.homeLogAdj, 0));
  check(() => assert.equal(noAdj.awayLogAdj, 0));

  const untouched = applyWithGuardrails(1.8, 1.0, noAdj);
  check(() => assert.equal(untouched.lambdaHome, 1.8, "ohne Faktoren bleibt lambda gleich"));
  check(() => assert.equal(untouched.lambdaAway, 1.0));

  // Klammerung: selbst absurd viele Faktoren duerfen die Grenze nicht ueberschreiten.
  const many: LlmMatchContext = {
    ...empty,
    foundAnything: true,
    keyFactors: Array.from({ length: 25 }, (_, i) =>
      factor({ subject: `Spieler ${i}`, role: i % 2 === 0 ? "forward" : "midfielder" })
    ),
  };
  const clamped = toLlmAdjustment(many);
  check(() =>
    assert.ok(
      Math.abs(clamped.homeLogAdj) <= DEFAULT_LLM_MAX_LOG_ADJUSTMENT + 1e-12,
      `Klammerung greift: ${clamped.homeLogAdj}`
    )
  );

  // Favoritenschutz: eine Korrektur, die die Tendenz drehen wuerde, wird zurueckgedreht
  // oder verworfen. Das LLM darf aus einem Heimsieg keinen Auswaertssieg machen.
  const tight: LlmMatchContext = {
    ...empty,
    foundAnything: true,
    keyFactors: [
      factor({ role: "forward" }),
      factor({ role: "midfielder", subject: "B" }),
      factor({ team: "away", role: "goalkeeper", direction: "strengthens", subject: "C" }),
    ],
  };
  const tightAdj = toLlmAdjustment(tight);

  // Ein knappes Spiel, bei dem Heim gerade eben vorn liegt.
  const baseHome = 1.34;
  const baseAway = 1.3;
  const baseOutcome = argmaxOutcome(outcomeProbsOf(baseHome, baseAway));
  const guarded = applyWithGuardrails(baseHome, baseAway, tightAdj);
  const guardedOutcome = argmaxOutcome(outcomeProbsOf(guarded.lambdaHome, guarded.lambdaAway));
  check(() =>
    assert.equal(guardedOutcome, baseOutcome, "die wahrscheinlichste Tendenz darf nicht kippen")
  );
  check(() =>
    assert.ok(
      guarded.adjustment.shrinkFactor >= 0 && guarded.adjustment.shrinkFactor <= 1,
      "Shrink-Faktor im Intervall"
    )
  );

  // Systematisch: ueber viele Lambda-Paare und Faktorlisten darf die Tendenz NIE kippen.
  const rng = mulberry32(4242);
  let flipped = 0;
  let shrunk = 0;
  for (let trial = 0; trial < 300; trial++) {
    const lh = 0.4 + rng() * 2.6;
    const la = 0.4 + rng() * 2.6;
    const count = 1 + Math.floor(rng() * 4);
    const roles: LlmKeyFactor["role"][] = ["forward", "midfielder", "defender", "goalkeeper"];
    const factors = Array.from({ length: count }, (_, i) =>
      factor({
        subject: `S${i}`,
        team: rng() < 0.5 ? "home" : "away",
        role: roles[Math.floor(rng() * roles.length)],
        direction: rng() < 0.5 ? "weakens" : "strengthens",
      })
    );
    const adj = toLlmAdjustment({ ...empty, foundAnything: true, keyFactors: factors });
    const before = argmaxOutcome(outcomeProbsOf(lh, la));
    const applied = applyWithGuardrails(lh, la, adj);
    const after = argmaxOutcome(outcomeProbsOf(applied.lambdaHome, applied.lambdaAway));
    if (before !== after) flipped++;
    if (applied.adjustment.shrinkFactor < 1) shrunk++;
  }
  checkCount += 300;
  check(() => assert.equal(flipped, 0, `${flipped} von 300 Tendenzen gekippt -- Guardrail defekt`));
  // Waere nie gedaempft worden, wuerde der Guardrail nichts pruefen.
  check(() => assert.ok(shrunk > 0, "in mindestens einem Fall muss der Guardrail eingreifen"));

  // Die Pipeline muss den Kontext auch tatsaechlich verwenden -- und ohne ihn identisch
  // rechnen wie vorher.
  const model = buildLeagueModel(loadAllMatches().filter((m) => m.season < "2025"));
  const withoutLlm = predictPipeline({
    model,
    homeTeam: "Bayern Munich",
    awayTeam: "Augsburg",
    market1x2: null,
  });
  const withLlmContext = predictPipeline({
    model,
    homeTeam: "Bayern Munich",
    awayTeam: "Augsburg",
    market1x2: null,
    llmContext: {
      ...empty,
      foundAnything: true,
      keyFactors: [factor({ role: "forward", importance: "key", certainty: "confirmed" })],
    },
  });
  check(() => assert.equal(withoutLlm.llmAdjustment, null, "ohne Kontext keine Korrektur"));
  check(() => assert.ok(withLlmContext.llmAdjustment !== null, "mit Kontext eine Korrektur"));
  check(() =>
    assert.ok(
      withLlmContext.expectedHomeGoals < withoutLlm.expectedHomeGoals,
      "fehlender Heim-Stuermer muss die Heim-Torerwartung senken"
    )
  );
  check(() =>
    closeTo(
      withLlmContext.formLambdaHome,
      withoutLlm.formLambdaHome,
      1e-12,
      "die Lambdas VOR der Korrektur bleiben unveraendert"
    )
  );
});

// ---------------------------------------------------------------------------

section("CSV-Merge erhaelt Quotenspalten", () => {
  // Der wichtigste Test der Datei: refreshCsvResults hat die Saisondatei komplett mit
  // sieben Spalten ueberschrieben und dabei jedes Mal alle Quotenspalten der laufenden
  // Saison geloescht. Genau die Spalten braucht die markt-implizierte Torerwartung.
  const dir = mkdtempSync(join(tmpdir(), "tippki-check-"));
  const file = join(dir, "D1_test.csv");

  try {
    const header = "Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,FTR,B365H,B365D,B365A,Avg>2.5,Avg<2.5,AHh";
    writeFileSync(
      file,
      `${header}\n` +
        `D1,28/08/2026,Bayern Munich,Stuttgart,,,,1.30,6.25,8.00,1.24,3.90,-1.75\n` +
        `D1,29/08/2026,RB Leipzig,M'gladbach,,,,1.55,4.20,5.50,1.40,2.90,-1.00\n`
    );

    writeCsvMerged(file, [
      { Div: "D1", Date: "28/08/2026", HomeTeam: "Bayern Munich", AwayTeam: "Stuttgart", FTHG: 3, FTAG: 1, FTR: "H" },
      { Div: "D1", Date: "30/08/2026", HomeTeam: "Dortmund", AwayTeam: "Hamburg", FTHG: 2, FTAG: 0, FTR: "H" },
    ]);

    const rows: Record<string, string>[] = parseCsv(readFileSync(file, "utf-8"), {
      columns: true,
      skip_empty_lines: true,
      bom: true,
    });

    check(() => assert.equal(rows.length, 3, "zwei bestehende plus eine neue Zeile"));
    check(() =>
      assert.deepEqual(Object.keys(rows[0]), header.split(","), "Spaltenreihenfolge unveraendert")
    );

    const bayern = rows.find((r) => r.HomeTeam === "Bayern Munich")!;
    check(() => assert.equal(bayern.FTHG, "3", "Ergebnis eingetragen"));
    check(() => assert.equal(bayern.FTR, "H"));
    check(() => assert.equal(bayern.B365H, "1.30", "1X2-Quote ueberlebt"));
    check(() => assert.equal(bayern["Avg>2.5"], "1.24", "Over/Under-Quote ueberlebt"));
    check(() => assert.equal(bayern.AHh, "-1.75", "Asian-Handicap-Linie ueberlebt"));

    const leipzig = rows.find((r) => r.HomeTeam === "RB Leipzig")!;
    check(() => assert.equal(leipzig.FTHG, "", "noch kein Ergebnis, bleibt leer"));
    check(() => assert.equal(leipzig["Avg<2.5"], "2.90", "Quoten unangetasteter Zeilen bleiben"));

    const dortmund = rows.find((r) => r.HomeTeam === "Dortmund")!;
    check(() => assert.equal(dortmund.FTHG, "2", "neue Zeile angehaengt"));
    check(() => assert.equal(dortmund.B365H, "", "neue Zeile hat keine Quoten, aber alle Spalten"));

    // Zweiter Durchlauf muss idempotent sein.
    writeCsvMerged(file, [
      { Div: "D1", Date: "28/08/2026", HomeTeam: "Bayern Munich", AwayTeam: "Stuttgart", FTHG: 3, FTAG: 1, FTR: "H" },
      { Div: "D1", Date: "30/08/2026", HomeTeam: "Dortmund", AwayTeam: "Hamburg", FTHG: 2, FTAG: 0, FTR: "H" },
    ]);
    const again: Record<string, string>[] = parseCsv(readFileSync(file, "utf-8"), {
      columns: true,
      skip_empty_lines: true,
      bom: true,
    });
    check(() => assert.equal(again.length, 3, "zweiter Lauf legt keine Duplikate an"));
    check(() => assert.deepEqual(again, rows, "zweiter Lauf aendert nichts"));

    // Frische Datei ohne Vorlage darf trotzdem funktionieren.
    const fresh = join(dir, "D1_neu.csv");
    writeCsvMerged(fresh, [
      { Div: "D1", Date: "01/09/2026", HomeTeam: "Mainz", AwayTeam: "Paderborn", FTHG: 1, FTAG: 1, FTR: "D" },
    ]);
    const freshRows: Record<string, string>[] = parseCsv(readFileSync(fresh, "utf-8"), {
      columns: true,
      skip_empty_lines: true,
    });
    check(() => assert.equal(freshRows.length, 1));
    check(() => assert.equal(freshRows[0].FTR, "D"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------

console.log(`\n${checkCount} Checks in ${sectionCount} Abschnitten bestanden.\n`);
