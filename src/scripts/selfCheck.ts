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
import { XG_FORM_WINDOW, computeXgForm } from "../model/xgForm";
import { predictFromLambdas } from "../model/predictMatch";
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
