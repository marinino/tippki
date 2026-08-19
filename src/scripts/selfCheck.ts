// Ersatz fuer das fehlende Testframework: node:assert/strict plus ein tsx-Skript.
// Deckt die Stellen ab, an denen ein Fehler still bleibt und trotzdem alle Zahlen
// verschiebt -- allen voran den Fall, dass eine Buchmacherquote in das Modell
// zurueckkriecht, das sie schlagen soll.
//
//   npm run check

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseCsv } from "csv-parse/sync";
import { writeCsvMerged } from "../data/refreshResults";
import { mergeMarketRows } from "../data/refreshMarketOdds";
import {
  DEFAULT_PIPELINE,
  canonicalUserPrompt,
  configHash,
  llmMappingFingerprint,
  llmPromptFingerprint,
  type PipelineConfig,
} from "../model/pipelineConfig";
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
  applyAdjustment,
  outcomeProbsOf,
  toLlmAdjustment,
} from "../llm/llmAdjustment";
import {
  FACT_CATEGORIES,
  isValidMatchContext,
  isValidMatchdayContext,
  type LlmKeyFactor,
  type LlmMatchContext,
  type PlayerRole,
} from "../llm/matchContext";
import { SEARCH_USD_PER_REQUEST, estimateCostUsd, resolveModelProfile } from "../llm/modelProfile";
import {
  applyOutcomeTemperature,
  argmaxCell,
  buildDixonColesMatrix,
  goalDifferenceMarginal,
  outcomeMasses,
  scoreProb,
  toScoreMap,
  totalGoalsMarginal,
} from "../model/scoreMatrix";
import { buildPriceSheet, priceOf } from "../model/priceSheet";
import {
  argmaxOutcome,
  binaryBrier,
  binaryLogLoss,
  brierScore,
  logLoss,
  outcomeOf,
  rankedProbabilityScore,
  scoreLogLoss,
  summarize,
  type OutcomeProbs,
  type PerMatchMetrics,
} from "../eval/metrics";
import { mcnemarExact, mulberry32, pairedBootstrap } from "../eval/significance";
import {
  benchmarkQuote,
  devigThreeWay,
  devigTwoWay,
  overroundOf,
  type BenchmarkSource,
} from "../eval/benchmarkOdds";
import { accuracyStandardError, seasonsFor } from "../eval/splits";
import { readdirSync, statSync } from "node:fs";

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

section("Modell kennt keine Buchmacherquote", () => {
  // Der strukturelle Test dieses Projekts, und der einzige, der eine ganze Klasse von
  // Fehlern faengt statt eines einzelnen. Das Ziel ist ein Modell, das den Markt schlaegt.
  // Sobald irgendeine Datei unter src/model/ eine Quote liest, ist dieses Ziel still
  // aufgehoben: die Zahlen sehen dann besser aus, gehoeren aber dem Buchmacher.
  //
  // Der Test prueft die Importe, nicht die Absicht. Absichten halten keine Refaktorierung
  // aus.
  const forbidden = ["benchmarkOdds", "closeOdds", "openOdds", "avgCloseOdds", "oddsApi"];
  const modelDir = join(process.cwd(), "src", "model");
  const offenders: string[] = [];

  // Kommentare vorher entfernen. Ohne das schlaegt der Test bei der Datei an, die
  // ERKLAERT, warum sie den Markt nicht anfasst -- und ein Test, der sich an der
  // Begruendung stoert statt am Code, wird beim ersten Mal entnervt geloescht.
  function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  }

  for (const file of readdirSync(modelDir)) {
    if (!file.endsWith(".ts")) continue;
    const code = stripComments(readFileSync(join(modelDir, file), "utf-8"));
    for (const needle of forbidden) {
      if (code.includes(needle)) offenders.push(`${file} enthaelt "${needle}"`);
    }
  }

  check(() =>
    assert.deepEqual(offenders, [], `src/model/ darf keine Marktdaten beruehren: ${offenders.join(", ")}`)
  );

  // Und die Gegenprobe: die Pipeline darf keine Eingabe fuer Marktdaten mehr anbieten.
  const pipelineSource = readFileSync(join(modelDir, "predictPipeline.ts"), "utf-8");
  check(() =>
    assert.ok(!/market1x2|marketTotals|marketSpread/.test(pipelineSource), "PipelineInput ist marktfrei")
  );

  // statSync nur, damit der Import benutzt wird und der Pfad wirklich ein Verzeichnis ist.
  check(() => assert.ok(statSync(modelDir).isDirectory()));
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

  // Zweiwertige Maerkte: dieselben Regeln, eine Dimension.
  check(() => closeTo(binaryLogLoss(1, true), 0, 1e-12, "sicher und richtig"));
  check(() => closeTo(binaryLogLoss(0.5, true), Math.log(2), 1e-12, "Muenzwurf"));
  check(() => closeTo(binaryLogLoss(0.25, false), Math.log(4 / 3), 1e-12, "Gegenseite"));
  check(() => closeTo(binaryBrier(0.7, true), 0.09, 1e-12, "Brier zweiwertig"));
  check(() => closeTo(binaryBrier(0.7, false), 0.49, 1e-12, "Brier Gegenseite"));
  check(() => assert.ok(Number.isFinite(binaryLogLoss(0, true)), "p=0 wird gedeckelt"));

  check(() => closeTo(scoreLogLoss(0.1), Math.log(10), 1e-12, "Correct-Score-LogLoss"));

  // summarize -- jeder Zusatzmarkt bringt seine eigene Fallzahl mit, weil er auf einer
  // Teilmenge der Spiele definiert sein kann.
  const rows: PerMatchMetrics[] = [
    {
      predicted: "H",
      actual: "H",
      rps: 0.1,
      logLoss: 0.5,
      brier: 0.2,
      totals: { logLoss: 0.6, brier: 0.2 },
      handicap: null,
      scoreLogLoss: 2.0,
    },
    {
      predicted: "H",
      actual: "A",
      rps: 0.5,
      logLoss: 1.5,
      brier: 1.0,
      totals: null,
      handicap: { logLoss: 0.8, brier: 0.3 },
      scoreLogLoss: null,
    },
  ];
  const s = summarize(rows);
  check(() => assert.equal(s.n, 2));
  check(() => closeTo(s.tendencyAccuracy, 0.5, 1e-12, "Trefferquote"));
  check(() => closeTo(s.rps, 0.3, 1e-12, "RPS-Mittel"));
  check(() => assert.equal(s.totalsN, 1, "nur eine Zeile hat den Torsummen-Markt"));
  check(() => closeTo(s.totalsLogLoss, 0.6, 1e-12, "und darf nur ueber die gemittelt werden"));
  check(() => assert.equal(s.handicapN, 1));
  check(() => closeTo(s.handicapLogLoss, 0.8, 1e-12, "Handicap-Mittel"));
  check(() => assert.equal(s.scoreN, 1));
  check(() => closeTo(s.scoreLogLoss, 2.0, 1e-12, "Correct-Score-Mittel"));

  check(() => assert.equal(summarize([]).n, 0, "Leere Eingabe darf nicht werfen"));
  check(() => assert.equal(summarize([]).totalsN, 0));
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

  // Randverteilungen: sie muessen dieselbe Masse tragen wie die Matrix selbst, sonst
  // stimmt jede daraus abgeleitete Quote nicht.
  const totalMarginal = totalGoalsMarginal(m);
  const diffMarginal = goalDifferenceMarginal(m);

  let totalSum = 0;
  for (const v of totalMarginal) totalSum += v;
  check(() => closeTo(totalSum, 1, 1e-12, "Torsummen-Randverteilung summiert auf 1"));

  let diffSum = 0;
  for (const v of diffMarginal) diffSum += v;
  check(() => closeTo(diffSum, 1, 1e-12, "Tordifferenz-Randverteilung summiert auf 1"));

  // Die drei Ausgangsmassen muessen sich aus der Tordifferenz rekonstruieren lassen.
  let fromDiffHome = 0;
  let fromDiffAway = 0;
  for (let d = 1; d <= m.maxGoals; d++) fromDiffHome += diffMarginal[d + m.maxGoals];
  for (let d = -m.maxGoals; d <= -1; d++) fromDiffAway += diffMarginal[d + m.maxGoals];
  check(() => closeTo(fromDiffHome, masses.homeWinProb, 1e-12, "Heimsieg aus der Differenz"));
  check(() => closeTo(fromDiffAway, masses.awayWinProb, 1e-12, "Auswaertssieg aus der Differenz"));
  check(() =>
    closeTo(diffMarginal[m.maxGoals], masses.drawProb, 1e-12, "Differenz 0 ist das Remis")
  );

  // Und die Torsumme gegen die direkte Summation ueber die Zellen.
  let over25 = 0;
  for (let h = 0; h <= m.maxGoals; h++) {
    for (let a = 0; a <= m.maxGoals; a++) {
      if (h + a > 2.5) over25 += scoreProb(m, h, a);
    }
  }
  let over25FromMarginal = 0;
  for (let k = 3; k < totalMarginal.length; k++) over25FromMarginal += totalMarginal[k];
  check(() => closeTo(over25FromMarginal, over25, 1e-12, "Over 2.5 aus der Randverteilung"));
});

// ---------------------------------------------------------------------------

section("Preisblatt", () => {
  const rng = mulberry32(1234);

  check(() => closeTo(priceOf(0.5).fairOdds, 2, 1e-12, "50% ist Quote 2.00"));
  check(() => closeTo(priceOf(0.25).fairOdds, 4, 1e-12, "25% ist Quote 4.00"));
  check(() => assert.ok(Number.isFinite(priceOf(0).fairOdds), "p=0 wird gedeckelt, nicht Infinity"));

  for (let trial = 0; trial < 100; trial++) {
    const lambdaHome = 0.2 + rng() * 3.5;
    const lambdaAway = 0.2 + rng() * 3.5;
    const matrix = buildDixonColesMatrix(lambdaHome, lambdaAway);
    const sheet = buildPriceSheet(matrix);

    // Jeder Markt muss auf 1 summieren -- das ist die definierende Eigenschaft einer
    // fairen Quote. Waeren es 1.05, haetten wir versehentlich eine Marge eingebaut und
    // wuerden uns gegen den Buchmacher besser rechnen, als wir sind.
    const o = sheet.outcome;
    assert.ok(
      Math.abs(o.home.prob + o.draw.prob + o.away.prob - 1) < 1e-12,
      `1X2 summiert nicht auf 1: ${o.home.prob + o.draw.prob + o.away.prob}`
    );
    assert.ok(
      Math.abs(sheet.bothTeamsToScore.yes.prob + sheet.bothTeamsToScore.no.prob - 1) < 1e-12,
      "BTTS summiert nicht auf 1"
    );
    for (const t of sheet.totals) {
      assert.ok(Math.abs(t.over.prob + t.under.prob - 1) < 1e-12, `Total ${t.line} summiert nicht auf 1`);
    }
    for (const h of sheet.handicaps) {
      assert.ok(Math.abs(h.home.prob + h.away.prob - 1) < 1e-12, `Handicap ${h.line} summiert nicht auf 1`);
    }

    // Doppelte Chance ist die Summe zweier Ausgaenge, nicht eine eigene Schaetzung.
    assert.ok(
      Math.abs(sheet.doubleChance.homeOrDraw.prob - (o.home.prob + o.draw.prob)) < 1e-12,
      "1X ist nicht die Summe von 1 und X"
    );

    // Monotonie der Leitern. Ohne sie waere die Verteilung in sich widerspruechlich:
    // "ueber 2.5 Tore" kann nicht wahrscheinlicher sein als "ueber 1.5".
    for (let i = 1; i < sheet.totals.length; i++) {
      assert.ok(
        sheet.totals[i].over.prob <= sheet.totals[i - 1].over.prob + 1e-12,
        `Torsummen-Leiter nicht monoton bei ${sheet.totals[i].line}`
      );
    }
    for (let i = 1; i < sheet.handicaps.length; i++) {
      assert.ok(
        sheet.handicaps[i].home.prob >= sheet.handicaps[i - 1].home.prob - 1e-12,
        `Handicap-Leiter nicht monoton bei ${sheet.handicaps[i].line}`
      );
    }

    // Handicap -0.5 ist definitionsgemaess der reine Heimsieg, +0.5 die doppelte Chance
    // 1X. Faellt das auseinander, ist die Vorzeichenkonvention der Linie verdreht -- und
    // das waere ein Fehler, den keine Aggregatzahl je zeigen wuerde.
    const minusHalf = sheet.handicaps.find((h) => h.line === -0.5)!;
    const plusHalf = sheet.handicaps.find((h) => h.line === 0.5)!;
    assert.ok(Math.abs(minusHalf.home.prob - o.home.prob) < 1e-12, "AH -0.5 != Heimsieg");
    assert.ok(
      Math.abs(plusHalf.home.prob - (o.home.prob + o.draw.prob)) < 1e-12,
      "AH +0.5 != Doppelte Chance 1X"
    );

    // Correct Score: die gelistete Masse plus der Rest ist die ganze Verteilung, und die
    // Liste ist absteigend sortiert.
    const listed = sheet.correctScore.reduce((sum, c) => sum + c.price.prob, 0);
    assert.ok(
      Math.abs(listed + sheet.correctScoreOther.prob - 1) < 1e-12,
      "Correct Score plus Rest ergibt nicht 1"
    );
    for (let i = 1; i < sheet.correctScore.length; i++) {
      assert.ok(
        sheet.correctScore[i].price.prob <= sheet.correctScore[i - 1].price.prob + 1e-15,
        "Correct-Score-Liste nicht absteigend"
      );
    }
    assert.equal(sheet.correctScore[0].score, argmaxCell(matrix), "Spitzenreiter != Argmax-Zelle");
  }
  checkCount += 100 * 10;

  // BTTS ueber die Randzeilen, nicht ueber die Unabhaengigkeitsannahme: bei rho != 0
  // muessen sich die beiden Wege unterscheiden, sonst wird die Dixon-Coles-Korrektur
  // in genau den Zellen ignoriert, fuer die es sie gibt.
  const correlated = buildDixonColesMatrix(1.5, 1.2, { rho: -0.15 });
  const sheet = buildPriceSheet(correlated);
  const naive = (1 - Math.exp(-1.5)) * (1 - Math.exp(-1.2));
  check(() =>
    assert.ok(
      Math.abs(sheet.bothTeamsToScore.yes.prob - naive) > 1e-4,
      "BTTS darf nicht die naive Unabhaengigkeitsformel sein"
    )
  );
});

// ---------------------------------------------------------------------------

section("Referenzquoten (Entvigen)", () => {
  // Die Messlatte selbst muss stimmen, sonst misst das ganze Projekt gegen die falsche
  // Zahl -- und zwar ohne dass irgendetwas auffaellt.
  check(() => closeTo(devigTwoWay(2, 2), 0.5, 1e-12, "faire Zweiwegquote"));
  check(() => closeTo(devigTwoWay(1.25, 5), 0.8, 1e-12, "1.25/5.00 ohne Marge"));
  check(() =>
    closeTo(devigTwoWay(1.9, 1.9), 0.5, 1e-12, "gleiche Quoten -> 50% trotz Overround")
  );

  const fair = devigThreeWay(3, 3, 3);
  check(() => closeTo(fair.homeWinProb, 1 / 3, 1e-12, "drei gleiche Quoten -> Drittel"));
  check(() => closeTo(fair.drawProb, 1 / 3, 1e-12, "Remis ebenso"));

  const real = devigThreeWay(1.8, 3.9, 4.4);
  const sum = real.homeWinProb + real.drawProb + real.awayWinProb;
  check(() => closeTo(sum, 1, 1e-12, "entvigte Wahrscheinlichkeiten summieren auf 1"));
  check(() =>
    assert.ok(real.homeWinProb < 1 / 1.8, "Entvigen muss jede Rohwahrscheinlichkeit senken")
  );

  check(() => closeTo(overroundOf(2, 2), 1, 1e-12, "faire Zweiwegwette hat Overround 1"));
  check(() => assert.ok(overroundOf(1.8, 3.9, 4.4) > 1, "echte Quoten tragen eine Marge"));

  // Und der Weg von der CSV-Zeile zur Messlatte. Faellt eine Namenskette in loadMatches.ts
  // still aus, laeuft der gepaarte Vergleich auf weniger Spielen, als die Ausgabe
  // behauptet -- und niemand merkt es.
  const matches = loadAllMatches();

  interface SourceCoverage {
    n: number;
    withQuote: number;
    overround: number;
  }

  function coverageOf(source: BenchmarkSource): Map<string, SourceCoverage> {
    const bySeason = new Map<string, SourceCoverage>();
    for (const match of matches) {
      const e = bySeason.get(match.season) ?? { n: 0, withQuote: 0, overround: 0 };
      e.n++;
      const q = benchmarkQuote(match, source);
      if (q) {
        e.withQuote++;
        e.overround += q.overround;
      }
      bySeason.set(match.season, e);
    }
    return bySeason;
  }

  const coverage: Record<BenchmarkSource, Map<string, SourceCoverage>> = {
    pinnacleClose: coverageOf("pinnacleClose"),
    marketAverageClose: coverageOf("marketAverageClose"),
    marketAverageOpen: coverageOf("marketAverageOpen"),
  };

  // Jede Auswertungssaison muss von MINDESTENS einer Quelle praktisch vollstaendig
  // abgedeckt sein. Keine einzelne Quelle schafft das ueber die ganze Historie: das
  // Marktmittel-Schluss beginnt erst 2019, und Pinnacle bricht in 2025/26 zur
  // Winterpause ab.
  for (const season of seasonsFor("all")) {
    const best = Math.max(
      ...(Object.keys(coverage) as BenchmarkSource[]).map((src) => {
        const e = coverage[src].get(season);
        return e ? e.withQuote / e.n : 0;
      })
    );
    assert.ok(best > 0.98, `Saison ${season}: keine Quelle deckt sie ab (beste ${best.toFixed(2)})`);
  }
  checkCount += seasonsFor("all").length;

  // Die bekannte Luecke festnageln. Waechst sie, oder schliesst sich eine andere, soll das
  // auffallen statt still die Fallzahlen zu verschieben.
  const pinnacle2025 = coverage.pinnacleClose.get("2025");
  check(() =>
    assert.ok(
      pinnacle2025 !== undefined && pinnacle2025.withQuote < pinnacle2025.n * 0.6,
      "Die dokumentierte Pinnacle-Luecke in 2025/26 ist verschwunden -- Kommentar in " +
        "benchmarkOdds.ts pruefen"
    )
  );

  // Overround im erwartbaren Bereich. Ein Wert unter 1 waere ein Vorzeichenfehler, einer
  // ueber 1.12 hiesse, dass wir versehentlich einen Freizeit-Buchmacher als "scharfe"
  // Referenz benutzen.
  for (const source of Object.keys(coverage) as BenchmarkSource[]) {
    for (const [season, e] of coverage[source]) {
      if (e.withQuote === 0) continue;
      const mean = e.overround / e.withQuote;
      assert.ok(
        mean > 1 && mean < 1.12,
        `${source} ${season}: Overround ${mean.toFixed(4)} ausserhalb des Erwartbaren`
      );
      checkCount++;
    }
  }

  // Handicap nur auf Halblinien -- alles andere waere keine Zweiwegwette.
  let withHandicap = 0;
  for (const match of matches) {
    const q = benchmarkQuote(match);
    if (q?.handicap) {
      withHandicap++;
      assert.equal(
        Math.abs(q.handicap.line % 1),
        0.5,
        `Handicap-Linie ${q.handicap.line} ist keine Halblinie`
      );
    }
  }
  check(() => assert.ok(withHandicap > 100, `zu wenige Handicap-Referenzen: ${withHandicap}`));
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

  const untouched = applyAdjustment(1.8, 1.0, noAdj);
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

  // Anwendung: die geklammerte Korrektur wirkt multiplikativ und exakt. Nichts zwischen
  // Klammerung und Torerwartung darf noch an der Groesse drehen.
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
  const applied = applyAdjustment(1.34, 1.3, tightAdj);
  check(() =>
    closeTo(applied.lambdaHome, 1.34 * Math.exp(tightAdj.homeLogAdj), 1e-12, "Heim exakt angewandt")
  );
  check(() =>
    closeTo(applied.lambdaAway, 1.3 * Math.exp(tightAdj.awayLogAdj), 1e-12, "Auswaerts exakt angewandt")
  );

  // Die Favoritensicherung ist am 2026-08-19 ausgebaut worden -- Begruendung und Messtabelle
  // stehen im Kopf von llmAdjustment.ts. Sie schuetzte das Tendenz-Etikett, das seit dem
  // Umbau gar nicht mehr bewertet wird, und verwarf dafuer in Tossup-Spielen die gesamte
  // Korrektur. Was bleibt, ist die Klammerung -- und die ist der Schutz, den dieser Test
  // festnagelt: egal welche Faktoren recherchiert werden, keine einzelne Ausgangs-
  // wahrscheinlichkeit darf sich um mehr als 20 Punkte bewegen. Ueber ein dichtes Raster
  // aller Lambda-Paare von 0,4 bis 3,0 liegt das gemessene Maximum bei 14,6 Punkten (bei
  // 3,00/3,00, also einem torreichen Gleichstand). Reisst dieser Test, ist die Klammerung
  // defekt.
  const MAX_SHIFT = 0.2;
  const rng = mulberry32(4242);
  let flipped = 0;
  let worstShift = 0;
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
    const out = applyAdjustment(lh, la, adj);
    const before = outcomeProbsOf(lh, la);
    const after = outcomeProbsOf(out.lambdaHome, out.lambdaAway);
    worstShift = Math.max(
      worstShift,
      Math.abs(after.homeWinProb - before.homeWinProb),
      Math.abs(after.drawProb - before.drawProb),
      Math.abs(after.awayWinProb - before.awayWinProb)
    );
    if (argmaxOutcome(before) !== argmaxOutcome(after)) flipped++;
  }
  checkCount += 300;
  check(() =>
    assert.ok(
      worstShift <= MAX_SHIFT,
      `groesste Verschiebung ${(worstShift * 100).toFixed(1)} Punkte -- Klammerung defekt`
    )
  );
  // Die Gegenprobe zum Ausbau: in knappen Spielen MUSS die Tendenz jetzt kippen koennen.
  // Baut jemand die Sicherung wieder ein, ohne die Messtabelle zu schlagen, faellt genau
  // dieser Check.
  check(() =>
    assert.ok(flipped > 0, "keine einzige Tendenz gekippt -- ist die Favoritensicherung zurueck?")
  );

  // Die Pipeline muss den Kontext auch tatsaechlich verwenden -- und ohne ihn identisch
  // rechnen wie vorher.
  const model = buildLeagueModel(loadAllMatches().filter((m) => m.season < "2025"));
  const withoutLlm = predictPipeline({
    model,
    homeTeam: "Bayern Munich",
    awayTeam: "Augsburg",
  });
  const withLlmContext = predictPipeline({
    model,
    homeTeam: "Bayern Munich",
    awayTeam: "Augsburg",
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

section("Quoten-Merge der laufenden Saison", () => {
  // Die Gegenrichtung zum Test darueber: dort kommen Ergebnisse zu einer Datei mit Quoten,
  // hier kommen Quoten zu einer Datei mit Ergebnissen. Der Merge schreibt die Saisondatei
  // vollstaendig neu und ist damit der einzige Schritt des Quotenabrufs, bei dem etwas
  // verloren gehen kann.
  const dir = mkdtempSync(join(tmpdir(), "tippki-market-"));
  const file = join(dir, "D1_2627.csv");

  try {
    // Ausgangslage wie nach einem OpenLigaDB-Refresh: sieben Spalten, keine Quote.
    writeFileSync(
      file,
      "Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,FTR\n" +
        "D1,28/08/2026,Bayern Munich,Stuttgart,3,1,H\n" +
        "D1,29/08/2026,Dortmund,M'gladbach,0,0,D\n" +
        "D1,05/09/2026,Mainz,Augsburg,2,1,H\n"
    );

    // football-data fuehrt die ersten beiden Spiele, das dritte noch nicht.
    const result = mergeMarketRows(file, [
      {
        Div: "D1",
        Date: "28/08/2026",
        HomeTeam: "Bayern Munich",
        AwayTeam: "Stuttgart",
        FTHG: "3",
        FTAG: "1",
        FTR: "H",
        PSCH: "1.28",
        PSCD: "6.40",
        PSCA: "9.50",
        AvgCH: "1.27",
      },
      {
        Div: "D1",
        Date: "29/08/2026",
        HomeTeam: "Dortmund",
        AwayTeam: "M'gladbach",
        FTHG: "0",
        FTAG: "0",
        FTR: "D",
        // Leere Pinnacle-Spalte: kommt in den Dateien vor und darf nichts kaputt machen.
        PSCH: "",
        PSCD: "",
        PSCA: "",
        AvgCH: "1.85",
      },
    ]);

    const rows: Record<string, string>[] = parseCsv(readFileSync(file, "utf-8"), {
      columns: true,
      skip_empty_lines: true,
      bom: true,
    });

    check(() => assert.equal(rows.length, 3, "kein Spiel verloren, keines verdoppelt"));
    check(() => assert.equal(result.updatedRows, 2));
    check(() => assert.equal(result.addedRows, 0, "beide Paarungen waren schon da"));

    const bayern = rows.find((r) => r.HomeTeam === "Bayern Munich")!;
    check(() => assert.equal(bayern.PSCH, "1.28", "Schlussquote eingetragen"));
    check(() => assert.equal(bayern.FTHG, "3", "Ergebnis bleibt stehen"));

    const dortmund = rows.find((r) => r.HomeTeam === "Dortmund")!;
    check(() => assert.equal(dortmund.PSCH, "", "leere Fremdspalte bleibt leer"));
    check(() => assert.equal(dortmund.AvgCH, "1.85", "Marktmittel trotzdem da"));

    // Der eigentliche Zweck des Merges: was football-data noch nicht kennt, ueberlebt.
    const mainz = rows.find((r) => r.HomeTeam === "Mainz")!;
    check(() => assert.equal(mainz.FTHG, "2", "lokal bekanntes Spiel bleibt erhalten"));
    check(() => assert.equal(mainz.PSCH, "", "hat noch keine Quote, aber alle Spalten"));

    // Zweiter Lauf mit denselben Daten darf nichts veraendern.
    mergeMarketRows(file, [
      {
        Div: "D1",
        Date: "28/08/2026",
        HomeTeam: "Bayern Munich",
        AwayTeam: "Stuttgart",
        FTHG: "3",
        FTAG: "1",
        FTR: "H",
        PSCH: "1.28",
        PSCD: "6.40",
        PSCA: "9.50",
        AvgCH: "1.27",
      },
    ]);
    const again: Record<string, string>[] = parseCsv(readFileSync(file, "utf-8"), {
      columns: true,
      skip_empty_lines: true,
      bom: true,
    });
    check(() => assert.equal(again.length, 3, "zweiter Lauf legt keine Duplikate an"));

    // Die Heimrechte gehoeren zum Schluessel: dieselben zwei Teams sind das Rueckspiel,
    // nicht dieselbe Zeile.
    const back = mergeMarketRows(file, [
      {
        Div: "D1",
        Date: "20/01/2027",
        HomeTeam: "Stuttgart",
        AwayTeam: "Bayern Munich",
        FTHG: "1",
        FTAG: "1",
        FTR: "D",
        PSCH: "4.10",
      },
    ]);
    check(() => assert.equal(back.addedRows, 1, "Rueckspiel ist eine eigene Zeile"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------

section("Kalibrierungstemperatur", () => {
  // Sie greift auf der Matrix, nicht auf drei Zahlen daneben. Was dabei erhalten bleiben
  // MUSS: die Normierung, die Reihenfolge der drei Ausgaenge und die Form innerhalb einer
  // Tendenz. Bricht eines davon, ist nicht die Kalibrierung schlecht, sondern das Preisblatt
  // widerspruechlich -- und das faellt in der UI zuerst am exakten Ergebnis auf.
  function matrixOf(lh: number, la: number) {
    return buildDixonColesMatrix(lh, la);
  }
  function sumOf(m: ReturnType<typeof matrixOf>) {
    let total = 0;
    for (let i = 0; i < m.cells.length; i++) total += m.cells[i];
    return total;
  }

  // T = 1 ist ein exakter Nulldurchgang, kein "fast gleich".
  const untouched = matrixOf(1.7, 1.1);
  const copy = Float64Array.from(untouched.cells);
  applyOutcomeTemperature(untouched, 1.0);
  check(() => assert.deepEqual(Array.from(untouched.cells), Array.from(copy), "T = 1 aendert nichts"));

  for (const [lh, la] of [
    [2.1, 0.9],
    [1.7, 1.1],
    [1.35, 1.35],
    [0.8, 2.2],
  ]) {
    const m = matrixOf(lh, la);
    const before = outcomeMasses(m);
    const shapeBefore = scoreProb(m, 3, 1) / scoreProb(m, 2, 0); // beide im Heimsieg-Block
    applyOutcomeTemperature(m, 1.2);
    const after = outcomeMasses(m);
    const shapeAfter = scoreProb(m, 3, 1) / scoreProb(m, 2, 0);

    check(() => closeTo(sumOf(m), 1, 1e-9, "Matrix bleibt normiert"));
    check(() => closeTo(shapeAfter, shapeBefore, 1e-9, "Form innerhalb der Tendenz unveraendert"));
    // T > 1 zieht zur Gleichverteilung: jede Masse rueckt naeher an ein Drittel.
    const closer = (a: number, b: number) => Math.abs(a - 1 / 3) <= Math.abs(b - 1 / 3) + 1e-12;
    check(() => assert.ok(closer(after.homeWinProb, before.homeWinProb), "Heim rueckt zur Mitte"));
    check(() => assert.ok(closer(after.awayWinProb, before.awayWinProb), "Auswaerts rueckt zur Mitte"));
    // Sie darf Abstaende verkleinern, aber nie die Rangfolge drehen: p^(1/T) ist streng
    // monoton in p. Paare, die vorher praktisch gleichauf lagen, bleiben aussen vor -- bei
    // lambda_heim == lambda_ausw sind Heim- und Auswaertsmasse bis auf die letzte
    // Gleitkommastelle identisch, und welche davon "vorn" liegt, entscheidet dann die
    // Rundung. Das ist keine Eigenschaft der Temperatur, sondern derselbe Muenzwurf, der
    // im Gleichstand ohnehin hinter jedem Tendenz-Etikett steckt.
    const massesOf = (p: typeof before) => [p.homeWinProb, p.drawProb, p.awayWinProb];
    const pairs: [number, number][] = [
      [0, 1],
      [0, 2],
      [1, 2],
    ];
    for (const [i, j] of pairs) {
      const gapBefore = massesOf(before)[i] - massesOf(before)[j];
      const gapAfter = massesOf(after)[i] - massesOf(after)[j];
      if (Math.abs(gapBefore) <= 1e-9) continue;
      check(() =>
        assert.equal(Math.sign(gapAfter), Math.sign(gapBefore), `Rangfolge ${i} zu ${j} haelt`)
      );
    }
  }

  // Gegenrichtung: T < 1 schaerft.
  const sharp = matrixOf(2.1, 0.9);
  const beforeSharp = outcomeMasses(sharp).homeWinProb;
  applyOutcomeTemperature(sharp, 0.8);
  check(() =>
    assert.ok(outcomeMasses(sharp).homeWinProb > beforeSharp, "T < 1 macht ueberzeugter")
  );

  // Unsinnige Eingaben duerfen die Matrix nicht zerstoeren -- lieber nichts tun.
  const robust = matrixOf(1.5, 1.5);
  const robustCopy = Float64Array.from(robust.cells);
  applyOutcomeTemperature(robust, Number.NaN);
  check(() =>
    assert.deepEqual(Array.from(robust.cells), Array.from(robustCopy), "NaN laesst die Matrix in Ruhe")
  );
});

// ---------------------------------------------------------------------------

section("Konfigurations-Hash", () => {
  // Der Hash steht in jeder Zeile des Vorwaerts-Logs und entscheidet, welche Vorhersagen
  // spaeter miteinander verglichen werden duerfen. Faengt er eine Aenderung nicht, sammelt
  // das Log still zwei Populationen unter derselben Kennung -- und der gepaarte Test darauf
  // ist wertlos, ohne dass es jemandem auffaellt.

  // Die Nutzeranweisung wird mit festen Platzhaltern gerendert und danach ziffernmaskiert.
  // Bliebe eine Ziffer stehen, waere es das Tagesdatum, und der Fingerabdruck waere am
  // naechsten Morgen ein anderer -- 34 Populationen statt einer.
  const canonical = canonicalUserPrompt();
  check(() =>
    assert.ok(!/\d/.test(canonical), `Ziffer im kanonischen Prompt: ${canonical.match(/.{0,20}\d.{0,20}/)?.[0]}`)
  );
  check(() => assert.ok(canonical.length > 200, "der kanonische Prompt ist nicht leer"));
  check(() =>
    assert.equal(llmPromptFingerprint(), llmPromptFingerprint(), "Fingerabdruck ist deterministisch")
  );
  check(() =>
    assert.equal(
      llmMappingFingerprint(),
      llmMappingFingerprint(),
      "Fingerabdruck der Faktenzuordnung ist deterministisch"
    )
  );
  // Die Gegenprobe, dass der Abdruck das Verhalten wirklich abtastet: lieferte die
  // Zuordnung fuer jede Kombination dieselbe Zahl, waere der Abdruck konstant und wuerde
  // auch keine Aenderung mehr treffen. Torwart und Stuermer muessen sich unterscheiden.
  const withRole = (role: PlayerRole) =>
    toLlmAdjustment({
      homeTeam: "A",
      awayTeam: "B",
      foundAnything: true,
      summary: "",
      keyFactors: [
        {
          team: "home",
          category: FACT_CATEGORIES[0],
          subject: "X",
          role,
          importance: "key",
          direction: "weakens",
          certainty: "confirmed",
          note: "",
          source: "",
        },
      ],
    });
  check(() =>
    assert.notEqual(
      withRole("goalkeeper").homeLogAdj,
      withRole("forward").homeLogAdj,
      "die Zuordnung unterscheidet Positionen -- sonst taste der Abdruck nichts ab"
    )
  );

  check(() => assert.equal(configHash(DEFAULT_PIPELINE), configHash(DEFAULT_PIPELINE), "Hash ist stabil"));

  // Jede einzelne Stellschraube muss den Hash bewegen. Ohne diese Schleife faellt es nicht
  // auf, wenn ein neues Feld zwar in PipelineConfig steht, aber in configHash vergessen
  // wurde -- der haeufigste Weg, wie so ein Hash still nutzlos wird.
  const variations: [string, Partial<PipelineConfig>][] = [
    ["ridgePseudoMatches", { ridgePseudoMatches: DEFAULT_PIPELINE.ridgePseudoMatches + 1 }],
    ["seasonRecencyWeights", { seasonRecencyWeights: [...DEFAULT_PIPELINE.seasonRecencyWeights, 0.1] }],
    ["xgFormWindow", { xgFormWindow: DEFAULT_PIPELINE.xgFormWindow + 1 }],
    ["xgFormWeight", { xgFormWeight: DEFAULT_PIPELINE.xgFormWeight + 0.01 }],
    ["maxGoals", { maxGoals: DEFAULT_PIPELINE.maxGoals + 1 }],
    ["rho", { rho: DEFAULT_PIPELINE.rho + 0.01 }],
    ["drawBoost", { drawBoost: DEFAULT_PIPELINE.drawBoost + 0.01 }],
    ["outcomeTemperature", { outcomeTemperature: DEFAULT_PIPELINE.outcomeTemperature + 0.05 }],
    ["llmGain", { llmGain: 0.8 }],
    ["llmMaxLogAdjustment", { llmMaxLogAdjustment: 0.2 }],
    ["llmPromptFingerprint", { llmPromptFingerprint: "anders01" }],
    ["llmMappingFingerprint", { llmMappingFingerprint: "anders02" }],
    ["llmModel", { llmModel: "claude-opus-5" }],
  ];

  const base = configHash(DEFAULT_PIPELINE);
  for (const [name, override] of variations) {
    check(() =>
      assert.notEqual(
        configHash({ ...DEFAULT_PIPELINE, ...override }),
        base,
        `${name} veraendert den Hash nicht -- fehlt es in configHash?`
      )
    );
  }
});

// ---------------------------------------------------------------------------

console.log(`\n${checkCount} Checks in ${sectionCount} Abschnitten bestanden.\n`);
