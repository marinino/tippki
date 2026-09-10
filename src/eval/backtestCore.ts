// Gemeinsamer Backtest-Kern.
//
// Aufbau in zwei Stufen, und das ist die wichtigste Entscheidung hier:
//
//   1. buildContexts() macht den teuren Teil -- Modell fitten, Formkurven berechnen,
//      Referenzquoten aufbereiten -- genau einmal pro Saison.
//   2. evaluateRun() ist danach reine Arithmetik ueber 121 Matrixzellen pro Spiel.
//
// Dadurch kostet das Durchprobieren einer weiteren Parametrisierung Millisekunden statt
// Sekunden. Ohne diese Trennung waere die Hyperparametersuche nicht machbar.
//
// Bewertet werden VIER Maerkte statt einem: 1X2, Torsumme ueber 2.5, Asian Handicap auf
// der Linie des Buchmachers und das exakte Ergebnis. Das ist der Unterschied zwischen
// "das Modell trifft die Tendenz" und "das Modell kann eine Verteilung bepreisen". Auf
// 1X2 allein sind Modell und Markt seit jeher fast gleichauf; die Frage, ob ein Heimsieg
// eher 1:0 oder 3:1 ausfaellt, hat bisher schlicht niemand gemessen.

import { loadAllMatches, parseMatchDate, type Match } from "../data/loadMatches";
import {
  PRODUCTION_MODEL_OPTIONS,
  buildLeagueModel,
  type LeagueModel,
  type LeagueModelOptions,
} from "../model/teamStrength";
import { baseLambdas } from "../model/predictMatch";
import {
  DEFAULT_OUTCOME_TEMPERATURE,
  applyOutcomeTemperature,
  buildDixonColesMatrix,
  goalDifferenceMarginal,
  outcomeMasses,
  scoreProb,
  totalGoalsMarginal,
  type ScoreMatrix,
} from "../model/scoreMatrix";
import { XG_FORM_WEIGHT, computeXgForm, computeXgFormResidual } from "../model/xgForm";
import {
  benchmarkQuote,
  DEFAULT_BENCHMARK,
  type BenchmarkQuote,
  type BenchmarkSource,
} from "./benchmarkOdds";
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
  type BinaryScores,
  type MetricSummary,
  type Outcome,
  type OutcomeProbs,
  type PerMatchMetrics,
} from "./metrics";
import { seasonsFor, type SplitName } from "./splits";
import {
  mcnemarExact,
  pairedBootstrap,
  type BootstrapResult,
  type McNemarResult,
} from "./significance";

export const TOTALS_LINE = 2.5;

export interface PredictionContext {
  season: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  actualHome: number;
  actualAway: number;
  actual: Outcome;
  actualTotal: number;
  // Torerwartungen aus den gefitteten Staerken, Formexponent NOCH NICHT angewandt.
  baseLambdaHome: number;
  baseLambdaAway: number;
  // Rohe xG-Differenz, damit sich das Formgewicht spaeter ohne Refit variieren laesst.
  homeForm: number;
  awayForm: number;
  // Dieselbe Groesse, aber als Abweichung vom eigenen Normalniveau -- ohne den
  // Teamstaerke-Anteil, der in homeForm/awayForm mit r = 0.73 steckt.
  homeFormResidual: number;
  awayFormResidual: number;
  homeIsEstimated: boolean;
  awayIsEstimated: boolean;
  // Die Messlatte. Wird NIE in eine Vorhersage eingespeist, nur danebengelegt.
  benchmark: BenchmarkQuote | null;
}

// Empirische Verteilungen der Trainingsspiele. Referenz ohne jede Modellleistung -- wer
// sie nicht schlaegt, hat nichts gelernt. Bisher gab es diese Untergrenze nur fuer 1X2;
// jetzt fuer jeden bewerteten Markt, sonst waere zum Beispiel ein Correct-Score-LogLoss
// von 2.9 eine Zahl ohne jeden Bezugspunkt.
export interface BaseRates {
  outcome: OutcomeProbs;
  overProb: number;
  // scoreProbs[h][a], auf dieselbe Kantenlaenge wie die Modellmatrix beschnitten.
  scoreProbs: number[][];
  // diffProbs[d + maxGoals] = P(Tordifferenz == d).
  diffProbs: Float64Array;
}

export interface SeasonContexts {
  season: string;
  trainMatchCount: number;
  baseRates: BaseRates;
  contexts: PredictionContext[];
}

// Eine Vorhersagelage aus einem gefitteten Modell und einem Spiel.
//
// Bewusst EINE Funktion fuer beide Aufbauwege. Stuende sie zweimal da, liefen die
// Saisongrenzen-Variante und die Walk-forward-Variante beim ersten hinzugefuegten Feld
// auseinander -- und der Vergleich zwischen ihnen, der ganze Zweck des Zweiten, waere
// still nicht mehr gepaart.
function makeContext(
  model: LeagueModel,
  match: Match,
  benchmark: BenchmarkSource
): PredictionContext {
  const matchDate = parseMatchDate(match.date);
  const base = baseLambdas(model, match.homeTeam, match.awayTeam);

  return {
    season: match.season,
    date: match.date,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    actualHome: match.homeGoals,
    actualAway: match.awayGoals,
    actual: outcomeOf(match.homeGoals, match.awayGoals),
    actualTotal: match.homeGoals + match.awayGoals,
    baseLambdaHome: base.lambdaHome,
    baseLambdaAway: base.lambdaAway,
    homeForm: computeXgForm(match.homeTeam, matchDate),
    awayForm: computeXgForm(match.awayTeam, matchDate),
    homeFormResidual: computeXgFormResidual(match.homeTeam, matchDate),
    awayFormResidual: computeXgFormResidual(match.awayTeam, matchDate),
    homeIsEstimated: base.homeIsEstimated,
    awayIsEstimated: base.awayIsEstimated,
    benchmark: benchmarkQuote(match, benchmark),
  };
}

// Trainiert ausschliesslich auf Saisons VOR der Testsaison -- EIN Fit je Saison.
//
// Das ist die historisch gewachsene Variante, und sie hat eine Eigenschaft, die lange
// niemandem auffiel: die juengste Trainingssaison ist hier IMMER vollstaendig. Der Zustand
// "mitten in einer angefangenen Saison", also genau der Zustand, in dem das Modell jeden
// Samstag wirklich laeuft, kommt darin nicht ein einziges Mal vor.
//
// Am 10.09.2026 hat das Geld gekostet: die Saisonbloecke gaben einer Saison mit 18
// gespielten Spielen dasselbe Gewicht wie einer fertigen, der Fit divergierte, und weder
// Backtest noch Tuner konnten es sehen -- sie hatten diese Lage nie vor Augen. Fuer die
// Fragen, die davon abhaengen, gibt es jetzt buildWalkForwardContexts.
export function buildContexts(
  seasons: string[],
  modelOptions: LeagueModelOptions = {},
  allMatches = loadAllMatches(),
  // Injizierbar, damit der Konvergenz-Audit denselben Auswertungspfad mit dem alten
  // Gradientenfit durchlaufen lassen kann. Sonst waere der Vergleich nicht gepaart.
  buildModel: (matches: Match[], options: LeagueModelOptions) => LeagueModel = buildLeagueModel,
  benchmark: BenchmarkSource = DEFAULT_BENCHMARK
): SeasonContexts[] {
  return seasons.map((testSeason) => {
    const trainMatches = allMatches.filter((m) => m.season < testSeason);
    const testMatches = allMatches.filter((m) => m.season === testSeason);
    const model = buildModel(trainMatches, modelOptions);

    const contexts = testMatches.map((match) => makeContext(model, match, benchmark));

    return {
      season: testSeason,
      trainMatchCount: trainMatches.length,
      baseRates: baseRatesOf(trainMatches),
      contexts,
    };
  });
}

// Bundesliga: 18 Mannschaften, also 9 Spiele je Spieltag. Die CSVs fuehren kein
// Spieltagsfeld, deshalb chronologisch in 9er-Bloecke gruppiert -- dieselbe Naeherung, die
// simulateSeason.ts benutzt. Bei Nachholspielen driftet die Einteilung gegenueber dem
// echten Spielplan; fuer die Frage "wie schnell soll das Modell innerhalb der Saison
// reagieren" ist das ohne Belang, denn die Trennlinie bleibt in jedem Fall ein echter
// Zeitpunkt, vor dem nichts bekannt ist.
export const MATCHES_PER_REFIT = 9;

// Walk-forward INNERHALB der Saison: vor jedem Spieltag neu fitten, mit allem, was bis
// dahin gespielt wurde -- die laufende Saison eingeschlossen.
//
// Das ist der Aufbau, der bisher fehlte, und ohne ihn ist eine ganze Klasse von Fragen
// unbeantwortbar. "Wie schnell soll das Modell innerhalb der Saison reagieren?" haengt an
// halfLifeDays und ridgePseudoMatches -- aber buildContexts trainiert nur bis zur
// Saisongrenze, misst also ausschliesslich "wie weit soll die Historie zurueckreichen".
// Zwei verschiedene Fragen, ein Parameter, und bisher nur die eine gemessen. Die 500 Tage
// in PRODUCTION_MODEL_OPTIONS stammen aus der ersten; fuer die zweite gab es schlicht kein
// Messgeraet.
//
// Der Schnitt liegt vor dem FRUEHESTEN Anpfiff des Blocks, nicht vor jedem einzelnen
// Spiel. Das ist kein Kompromiss, sondern die getreue Nachbildung des Echtbetriebs: die
// Automatik holt den Spielkontext und schreibt das Vorwaerts-Log einmal je Spieltag, drei
// Stunden vor dem ersten Anpfiff. Ein Sonntagsspiel kennt also auch produktiv das
// Freitagsergebnis noch nicht.
//
// Kosten: ein Fit dauert rund 23 ms, macht 34 Fits je Saison und wenige Sekunden fuer
// einen vollen Durchlauf. Der Grund, warum es das nicht laengst gab, war also nicht die
// Rechenzeit.
export function buildWalkForwardContexts(
  seasons: string[],
  modelOptions: LeagueModelOptions = PRODUCTION_MODEL_OPTIONS,
  allMatches = loadAllMatches(),
  buildModel: (matches: Match[], options: LeagueModelOptions) => LeagueModel = buildLeagueModel,
  benchmark: BenchmarkSource = DEFAULT_BENCHMARK,
  matchesPerRefit = MATCHES_PER_REFIT
): SeasonContexts[] {
  // Einmal vorsortieren statt in jeder Schleife: die Zeitachse ist die einzige Struktur,
  // auf die es hier ankommt.
  const byTime = [...allMatches].sort(
    (a, b) => parseMatchDate(a.date).getTime() - parseMatchDate(b.date).getTime()
  );

  return seasons.map((testSeason) => {
    const seasonMatches = byTime.filter((m) => m.season === testSeason);
    const beforeSeason = allMatches.filter((m) => m.season < testSeason);

    const contexts: PredictionContext[] = [];
    let lastTrainCount = beforeSeason.length;

    for (let start = 0; start < seasonMatches.length; start += matchesPerRefit) {
      const block = seasonMatches.slice(start, start + matchesPerRefit);
      const cutoff = parseMatchDate(block[0].date).getTime();

      // Strikt kleiner: ein Spiel, das exakt zum Schnittzeitpunkt angepfiffen wird, ist
      // Teil dieses Blocks und darf sich nicht selbst ins Training schmuggeln.
      const trainMatches = byTime.filter((m) => parseMatchDate(m.date).getTime() < cutoff);
      lastTrainCount = trainMatches.length;

      const model = buildModel(trainMatches, modelOptions);
      for (const match of block) contexts.push(makeContext(model, match, benchmark));
    }

    return {
      season: testSeason,
      // Der Stand beim LETZTEN Refit, also am Saisonende. Bei buildContexts ist die Zahl
      // ueber die Saison konstant; hier waechst sie, und die groesste ist die aussagekraeftige.
      trainMatchCount: lastTrainCount,
      // Grundraten bewusst aus den Spielen VOR der Saison, exakt wie bei buildContexts.
      // Sie sind die modellfreie Untergrenze, an der beide Aufbauwege gemessen werden --
      // waere sie hier eine andere, waeren die beiden Zahlen nicht mehr vergleichbar.
      baseRates: baseRatesOf(beforeSeason),
      contexts,
    };
  });
}

const BASE_RATE_MAX_GOALS = 10;

// Laplace-Glaettung mit einem Pseudospiel je Zelle. Ohne sie bekaeme ein in den
// Trainingsdaten nie vorgekommenes Ergebnis (etwa 7:5) die Wahrscheinlichkeit 0 und damit
// LogLoss = 34.5 -- eine einzige solche Zelle wuerde den Mittelwert der Referenz
// dominieren und den Vergleich wertlos machen.
function baseRatesOf(matches: Match[]): BaseRates {
  const size = BASE_RATE_MAX_GOALS + 1;
  const counts = Array.from({ length: size }, () => new Array<number>(size).fill(1));
  const diffCounts = new Float64Array(2 * BASE_RATE_MAX_GOALS + 1).fill(1);

  let home = 0;
  let draw = 0;
  let over = 0;
  let cellTotal = size * size;
  let diffTotal = diffCounts.length;

  for (const m of matches) {
    const o = outcomeOf(m.homeGoals, m.awayGoals);
    if (o === "H") home++;
    else if (o === "D") draw++;
    if (m.homeGoals + m.awayGoals > TOTALS_LINE) over++;

    const h = Math.min(m.homeGoals, BASE_RATE_MAX_GOALS);
    const a = Math.min(m.awayGoals, BASE_RATE_MAX_GOALS);
    counts[h][a]++;
    cellTotal++;
    diffCounts[h - a + BASE_RATE_MAX_GOALS]++;
    diffTotal++;
  }

  const n = matches.length;
  const outcome: OutcomeProbs =
    n === 0
      ? { homeWinProb: 1 / 3, drawProb: 1 / 3, awayWinProb: 1 / 3 }
      : { homeWinProb: home / n, drawProb: draw / n, awayWinProb: (n - home - draw) / n };

  return {
    outcome,
    overProb: n === 0 ? 0.5 : over / n,
    scoreProbs: counts.map((row) => row.map((c) => c / cellTotal)),
    diffProbs: diffCounts.map((c) => c / diffTotal) as Float64Array,
  };
}

// model      -- das eigenstaendige Modell. Die Zielgroesse dieses Projekts.
// benchmark  -- die entvigte Buchmacher-Schlussquote. Die zu schlagende Messlatte.
// baseRate   -- empirische Haeufigkeiten der Trainingsspiele. Die Untergrenze.
export type VariantName = "model" | "benchmark" | "baseRate";

export const ALL_VARIANTS: VariantName[] = ["model", "benchmark", "baseRate"];

export const VARIANT_LABELS: Record<VariantName, string> = {
  model: "Modell",
  benchmark: "Buchmacher",
  baseRate: "Grundrate",
};

export interface RunSpec {
  name: string;
  variant: VariantName;
  // Gewicht der Formkurve. Default ist der produktive Wert aus xgForm.ts.
  xgFormWeight?: number;
  // "diff" = rohe xG-Differenz (Ist-Zustand), "residual" = Abweichung vom Normalniveau.
  formMode?: "diff" | "residual";
  // Matrixparameter. Ohne Angabe die produktiven Werte aus scoreMatrix.ts.
  rho?: number;
  drawBoost?: number;
  // Kalibrierungstemperatur auf den 1X2-Massen. Ohne Angabe der produktive Wert.
  outcomeTemperature?: number;
}

export interface MatchEvaluation {
  season: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  actualHome: number;
  actualAway: number;
  actual: Outcome;
  probs: OutcomeProbs;
  predicted: Outcome;
  // Was die Variante auf den Zusatzmaerkten sagt. null = bepreist sie nicht.
  overProb: number | null;
  handicapLine: number | null;
  handicapHomeProb: number | null;
  exactScoreProb: number | null;
  // Nur bei der Modellvariante gesetzt -- fuer Diagnose und fuer das Preisblatt.
  matrix: ScoreMatrix | null;
  // Die Referenz auf demselben Spiel, damit Skripte den Abstand direkt bilden koennen.
  benchmarkProbs: OutcomeProbs | null;
  metrics: PerMatchMetrics;
}

function binary(prob: number, happened: boolean): BinaryScores {
  return { logLoss: binaryLogLoss(prob, happened), brier: binaryBrier(prob, happened) };
}

interface VariantPrediction {
  probs: OutcomeProbs;
  overProb: number | null;
  handicapHomeProb: number | null;
  exactScoreProb: number | null;
  matrix: ScoreMatrix | null;
}

// P(Tordifferenz > -line), also die Seite, auf der Heim das Handicap deckt.
function coverProbFromMarginal(
  diffMarginal: Float64Array,
  maxGoals: number,
  line: number
): number {
  let sum = 0;
  for (let d = Math.max(Math.ceil(-line), -maxGoals); d <= maxGoals; d++) {
    sum += diffMarginal[d + maxGoals];
  }
  return sum;
}

function predictVariant(
  variant: VariantName,
  ctx: PredictionContext,
  spec: RunSpec,
  baseRates: BaseRates
): VariantPrediction | null {
  const line = ctx.benchmark?.handicap?.line ?? null;

  if (variant === "benchmark") {
    if (!ctx.benchmark) return null;
    return {
      probs: ctx.benchmark.probs,
      overProb: ctx.benchmark.totalsOverProb,
      handicapHomeProb: ctx.benchmark.handicap?.homeCoverProb ?? null,
      exactScoreProb: null,
      matrix: null,
    };
  }

  if (variant === "baseRate") {
    const h = Math.min(ctx.actualHome, BASE_RATE_MAX_GOALS);
    const a = Math.min(ctx.actualAway, BASE_RATE_MAX_GOALS);
    return {
      probs: baseRates.outcome,
      overProb: baseRates.overProb,
      handicapHomeProb:
        line === null
          ? null
          : coverProbFromMarginal(baseRates.diffProbs, BASE_RATE_MAX_GOALS, line),
      exactScoreProb: baseRates.scoreProbs[h][a],
      matrix: null,
    };
  }

  const formWeight = spec.xgFormWeight ?? XG_FORM_WEIGHT;
  const residual = spec.formMode === "residual";
  const homeForm = residual ? ctx.homeFormResidual : ctx.homeForm;
  const awayForm = residual ? ctx.awayFormResidual : ctx.awayForm;
  const matrix = buildDixonColesMatrix(
    ctx.baseLambdaHome * Math.exp(formWeight * homeForm),
    ctx.baseLambdaAway * Math.exp(formWeight * awayForm),
    { rho: spec.rho, drawBoost: spec.drawBoost }
  );
  // Vor allem anderen: Totals, Handicap und exaktes Ergebnis werden aus derselben Matrix
  // gelesen und muessen dieselbe Temperatur gesehen haben wie die 1X2-Massen.
  applyOutcomeTemperature(matrix, spec.outcomeTemperature ?? DEFAULT_OUTCOME_TEMPERATURE);

  const totalMarginal = totalGoalsMarginal(matrix);
  let over = 0;
  for (let k = Math.ceil(TOTALS_LINE); k < totalMarginal.length; k++) over += totalMarginal[k];

  return {
    probs: outcomeMasses(matrix),
    overProb: over,
    handicapHomeProb:
      line === null
        ? null
        : coverProbFromMarginal(goalDifferenceMarginal(matrix), matrix.maxGoals, line),
    exactScoreProb: scoreProb(matrix, ctx.actualHome, ctx.actualAway),
    matrix,
  };
}

export interface EvaluateOptions {
  // Matrizen mitliefern. Kostet Speicher und ist fuer die Hyperparametersuche unnoetig.
  keepMatrices?: boolean;
  // Nur Spiele auswerten, fuer die eine Referenzquote vorliegt. Ohne das laufen Modell
  // und Buchmacher auf verschiedenen Spielmengen und jeder gepaarte Test ist hinfaellig.
  requireBenchmark?: boolean;
}

export function evaluateRun(
  seasonContexts: SeasonContexts[],
  spec: RunSpec,
  options: EvaluateOptions = {}
): MatchEvaluation[] {
  const requireBenchmark = options.requireBenchmark ?? true;
  const evaluations: MatchEvaluation[] = [];

  for (const season of seasonContexts) {
    for (const ctx of season.contexts) {
      if (requireBenchmark && !ctx.benchmark) continue;

      const p = predictVariant(spec.variant, ctx, spec, season.baseRates);
      if (!p) continue;

      const overHappened = ctx.actualTotal > TOTALS_LINE;
      const line = ctx.benchmark?.handicap?.line ?? null;
      const covered =
        line === null ? null : ctx.actualHome - ctx.actualAway > -line;

      evaluations.push({
        season: ctx.season,
        date: ctx.date,
        homeTeam: ctx.homeTeam,
        awayTeam: ctx.awayTeam,
        actualHome: ctx.actualHome,
        actualAway: ctx.actualAway,
        actual: ctx.actual,
        probs: p.probs,
        predicted: argmaxOutcome(p.probs),
        overProb: p.overProb,
        handicapLine: line,
        handicapHomeProb: p.handicapHomeProb,
        exactScoreProb: p.exactScoreProb,
        matrix: options.keepMatrices ? p.matrix : null,
        benchmarkProbs: ctx.benchmark?.probs ?? null,
        metrics: {
          predicted: argmaxOutcome(p.probs),
          actual: ctx.actual,
          rps: rankedProbabilityScore(p.probs, ctx.actual),
          logLoss: logLoss(p.probs, ctx.actual),
          brier: brierScore(p.probs, ctx.actual),
          totals: p.overProb === null ? null : binary(p.overProb, overHappened),
          handicap:
            p.handicapHomeProb === null || covered === null
              ? null
              : binary(p.handicapHomeProb, covered),
          scoreLogLoss: p.exactScoreProb === null ? null : scoreLogLoss(p.exactScoreProb),
        },
      });
    }
  }

  return evaluations;
}

export interface BacktestOptions {
  split?: SplitName;
  seasons?: string[];
  variant?: VariantName;
  benchmark?: BenchmarkSource;
  includeEvaluations?: boolean;
}

export interface SeasonSummary {
  season: string;
  trainMatchCount: number;
  summary: MetricSummary;
}

export interface BacktestResult {
  seasons: string[];
  variant: VariantName;
  benchmark: BenchmarkSource;
  perSeason: SeasonSummary[];
  overall: MetricSummary;
  baselines: Record<VariantName, MetricSummary>;
  evaluations: MatchEvaluation[];
  // Spiele der Saison insgesamt und davon mit Referenzquote. Die Differenz ist die
  // Menge, die aus dem gepaarten Vergleich herausfaellt.
  totalMatches: number;
  totalEvaluated: number;
}

export function runBacktest(opts: BacktestOptions = {}): BacktestResult {
  const seasons = opts.seasons ?? seasonsFor(opts.split ?? "all");
  const variant = opts.variant ?? "model";
  const benchmark = opts.benchmark ?? DEFAULT_BENCHMARK;

  const seasonContexts = buildContexts(
    seasons,
    PRODUCTION_MODEL_OPTIONS,
    loadAllMatches(),
    buildLeagueModel,
    benchmark
  );
  const spec: RunSpec = { name: variant, variant };
  const evaluations = evaluateRun(seasonContexts, spec);

  const bySeason = new Map<string, MatchEvaluation[]>();
  for (const e of evaluations) {
    const list = bySeason.get(e.season);
    if (list) list.push(e);
    else bySeason.set(e.season, [e]);
  }

  const perSeason: SeasonSummary[] = seasonContexts.map((s) => ({
    season: s.season,
    trainMatchCount: s.trainMatchCount,
    summary: summarize((bySeason.get(s.season) ?? []).map((e) => e.metrics)),
  }));

  const baselines = {} as Record<VariantName, MetricSummary>;
  for (const name of ALL_VARIANTS) {
    baselines[name] =
      name === variant
        ? summarize(evaluations.map((e) => e.metrics))
        : summarize(
            evaluateRun(seasonContexts, { name, variant: name }).map((e) => e.metrics)
          );
  }

  return {
    seasons,
    variant,
    benchmark,
    perSeason,
    overall: summarize(evaluations.map((e) => e.metrics)),
    baselines,
    evaluations: opts.includeEvaluations ? evaluations : [],
    totalMatches: seasonContexts.reduce((sum, s) => sum + s.contexts.length, 0),
    totalEvaluated: evaluations.length,
  };
}

export interface RunComparison {
  a: string;
  b: string;
  n: number;
  summaryA: MetricSummary;
  summaryB: MetricSummary;
  // Tendenz: nur die Spiele zaehlen, auf denen sich die beiden Laeufe unterscheiden.
  tendency: McNemarResult;
  rps: BootstrapResult;
  logLoss: BootstrapResult;
  // null, wenn einer der beiden Laeufe den Markt nicht bepreist.
  totalsLogLoss: BootstrapResult | null;
  handicapLogLoss: BootstrapResult | null;
  scoreLogLoss: BootstrapResult | null;
  perSeasonRpsDiff: { season: string; diff: number }[];
}

// Gepaarter Vergleich zweier Laeufe auf exakt denselben Spielen. Der einzige Weg,
// Unterschiede aufzuloesen, die kleiner sind als der Standardfehler der Trefferquote
// (1.01pp bei n=2448) -- und das sind hier praktisch alle.
export function compareRuns(
  seasonContexts: SeasonContexts[],
  specA: RunSpec,
  specB: RunSpec
): RunComparison {
  const evalA = evaluateRun(seasonContexts, specA);
  const evalB = evaluateRun(seasonContexts, specB);

  if (evalA.length !== evalB.length) {
    throw new Error("Laeufe haben unterschiedlich viele Spiele -- gepaarter Test unmoeglich");
  }

  let onlyA = 0;
  let onlyB = 0;
  const rpsDiffs: number[] = [];
  const logLossDiffs: number[] = [];
  const totalsDiffs: number[] = [];
  const handicapDiffs: number[] = [];
  const scoreDiffs: number[] = [];
  const seasonTotals = new Map<string, { sum: number; n: number }>();

  for (let i = 0; i < evalA.length; i++) {
    const a = evalA[i].metrics;
    const b = evalB[i].metrics;
    const aCorrect = a.predicted === a.actual;
    const bCorrect = b.predicted === b.actual;
    if (aCorrect && !bCorrect) onlyA++;
    else if (!aCorrect && bCorrect) onlyB++;

    // Niedriger ist bei allen diesen Metriken besser, deshalb umgedreht: positiv = A ist
    // besser als B.
    rpsDiffs.push(b.rps - a.rps);
    logLossDiffs.push(b.logLoss - a.logLoss);
    if (a.totals && b.totals) totalsDiffs.push(b.totals.logLoss - a.totals.logLoss);
    if (a.handicap && b.handicap) handicapDiffs.push(b.handicap.logLoss - a.handicap.logLoss);
    if (a.scoreLogLoss !== null && b.scoreLogLoss !== null) {
      scoreDiffs.push(b.scoreLogLoss - a.scoreLogLoss);
    }

    const bucket = seasonTotals.get(evalA[i].season) ?? { sum: 0, n: 0 };
    bucket.sum += b.rps - a.rps;
    bucket.n++;
    seasonTotals.set(evalA[i].season, bucket);
  }

  return {
    a: specA.name,
    b: specB.name,
    n: evalA.length,
    summaryA: summarize(evalA.map((e) => e.metrics)),
    summaryB: summarize(evalB.map((e) => e.metrics)),
    tendency: mcnemarExact(onlyA, onlyB),
    rps: pairedBootstrap(rpsDiffs),
    logLoss: pairedBootstrap(logLossDiffs),
    totalsLogLoss: totalsDiffs.length > 0 ? pairedBootstrap(totalsDiffs) : null,
    handicapLogLoss: handicapDiffs.length > 0 ? pairedBootstrap(handicapDiffs) : null,
    scoreLogLoss: scoreDiffs.length > 0 ? pairedBootstrap(scoreDiffs) : null,
    perSeasonRpsDiff: [...seasonTotals.entries()].map(([season, b]) => ({
      season,
      diff: b.sum / b.n,
    })),
  };
}
