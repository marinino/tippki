// Gemeinsamer Backtest-Kern.
//
// Ersetzt die bisher wortgleich duplizierte Logik in src/scripts/backtest.ts und
// src/app/api/backtest/route.ts. Zwei Kopien derselben Auswertung heissen zwangslaeufig,
// dass irgendwann nur eine davon gepflegt wird und UI und Konsole verschiedene Zahlen
// zeigen.
//
// Aufbau in zwei Stufen, und das ist die wichtigste Entscheidung hier:
//
//   1. buildContexts() macht den teuren Teil -- Modell fitten, Formkurven berechnen,
//      Marktquoten aufbereiten -- genau einmal pro Saison.
//   2. evaluateVariant() ist danach reine Arithmetik ueber 121 Matrixzellen pro Spiel.
//
// Dadurch kostet das Durchprobieren einer weiteren Parametrisierung Millisekunden statt
// Sekunden. Ohne diese Trennung waere die Hyperparametersuche in Phase 2 nicht machbar.

import { loadAllMatches, parseMatchDate, type Match } from "../data/loadMatches";
import {
  buildLeagueModel,
  type LeagueModel,
  type LeagueModelOptions,
} from "../model/teamStrength";
import { baseLambdas } from "../model/predictMatch";
import {
  argmaxCell,
  buildDixonColesMatrix,
  outcomeMasses,
  reweightToOutcomeMasses,
} from "../model/scoreMatrix";
import { expectedPointsForTip, selectEvTip } from "../model/tipSelector";
import {
  applyConstraints,
  devigTwoWay,
  outcomeConstraint,
  totalOverConstraint,
  type MatrixConstraint,
} from "../model/marketConstraints";
import { XG_FORM_WEIGHT, computeXgForm, computeXgFormResidual } from "../model/xgForm";
import { ODDS_BLEND_ALPHA, blendWithMarket, impliedProbabilities } from "../model/marketOdds";
import {
  argmaxOutcome,
  brierScore,
  logLoss,
  outcomeOf,
  rankedProbabilityScore,
  summarize,
  type MetricSummary,
  type Outcome,
  type OutcomeProbs,
  type PerMatchMetrics,
} from "./metrics";
import { resolveScheme, pointsFor, type ScoringScheme } from "./scoringScheme";
import { seasonsFor, type SplitName } from "./splits";
import {
  mcnemarExact,
  pairedBootstrap,
  type BootstrapResult,
  type McNemarResult,
} from "./significance";

export interface PredictionContext {
  season: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  actualHome: number;
  actualAway: number;
  actual: Outcome;
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
  market1x2: OutcomeProbs | null;
  // Entvigte Marktwahrscheinlichkeit fuer "mehr als 2.5 Tore". Die einzige Totals-Linie
  // in den historischen Daten; live gibt es eine ganze Leiter.
  totalsOverProb: number | null;
}

export interface SeasonContexts {
  season: string;
  trainMatchCount: number;
  // Empirische H/U/A-Haeufigkeit der Trainingsspiele -- Referenz ohne jede Modellleistung.
  trainBaseRate: OutcomeProbs;
  contexts: PredictionContext[];
}

// Strikt walk-forward: trainiert wird ausschliesslich auf Saisons VOR der Testsaison.
export function buildContexts(
  seasons: string[],
  modelOptions: LeagueModelOptions = {},
  allMatches = loadAllMatches(),
  // Injizierbar, damit der Konvergenz-Audit denselben Auswertungspfad mit dem alten
  // Gradientenfit durchlaufen lassen kann. Sonst waere der Vergleich nicht gepaart.
  buildModel: (matches: Match[], options: LeagueModelOptions) => LeagueModel = buildLeagueModel
): SeasonContexts[] {
  return seasons.map((testSeason) => {
    const trainMatches = allMatches.filter((m) => m.season < testSeason);
    const testMatches = allMatches.filter((m) => m.season === testSeason);
    const model = buildModel(trainMatches, modelOptions);

    const contexts = testMatches.map((match): PredictionContext => {
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
        baseLambdaHome: base.lambdaHome,
        baseLambdaAway: base.lambdaAway,
        homeForm: computeXgForm(match.homeTeam, matchDate),
        awayForm: computeXgForm(match.awayTeam, matchDate),
        homeFormResidual: computeXgFormResidual(match.homeTeam, matchDate),
        awayFormResidual: computeXgFormResidual(match.awayTeam, matchDate),
        homeIsEstimated: base.homeIsEstimated,
        awayIsEstimated: base.awayIsEstimated,
        market1x2: marketProbsOf(match),
        totalsOverProb:
          match.oddsOver25 && match.oddsUnder25
            ? devigTwoWay(match.oddsOver25, match.oddsUnder25)
            : null,
      };
    });

    return {
      season: testSeason,
      trainMatchCount: trainMatches.length,
      trainBaseRate: baseRateOf(trainMatches),
      contexts,
    };
  });
}

function marketProbsOf(match: Match): OutcomeProbs | null {
  if (!match.oddsHome || !match.oddsDraw || !match.oddsAway) return null;
  return impliedProbabilities(match.oddsHome, match.oddsDraw, match.oddsAway);
}

function baseRateOf(matches: Match[]): OutcomeProbs {
  if (matches.length === 0) return { homeWinProb: 1 / 3, drawProb: 1 / 3, awayWinProb: 1 / 3 };
  let home = 0;
  let draw = 0;
  for (const m of matches) {
    const o = outcomeOf(m.homeGoals, m.awayGoals);
    if (o === "H") home++;
    else if (o === "D") draw++;
  }
  const n = matches.length;
  return {
    homeWinProb: home / n,
    drawProb: draw / n,
    awayWinProb: (n - home - draw) / n,
  };
}

// modelOnly   -- reines Modell, reproduziert die historische 52.5%-Zahl
// blended     -- 50/50 Modell + Markt, reproduziert die historische 53.0%-Zahl
// pureMarket  -- nur die entvigten Buchmacherquoten. Diese Zahl kannte bisher niemand,
//                und sie entscheidet, ob das Modell zur 1X2-Prognose ueberhaupt etwas
//                beitraegt oder ob der Blend nur den Markt verwaessert.
// baseRate    -- Trainingshaeufigkeit von H/U/A. Ihr Argmax ist immer "H", die
//                Trefferquote ist also gleichzeitig die "immer Heimsieg"-Untergrenze,
//                und ihr RPS ist die kalibrierte Nullreferenz.
export type VariantName = "modelOnly" | "blended" | "pureMarket" | "baseRate";

export const ALL_VARIANTS: VariantName[] = ["modelOnly", "blended", "pureMarket", "baseRate"];

// Wie der abzugebende Tipp aus der Matrix gewaehlt wird.
//
// argmaxLegacy      Argmax der UNKORRIGIERTEN Modellmatrix. Das ist der Ist-Zustand --
//                   der angezeigte Tipp ignoriert die Marktquoten vollstaendig, auch
//                   wenn die 1X2-Balken daneben geblendet sind.
// argmaxReweighted  Argmax der marktkorrigierten Matrix. Isoliert den reinen Effekt,
//                   die Marktinformation ueberhaupt in den Tipp zu lassen.
// ev                Punkte-Erwartungswert auf der marktkorrigierten Matrix. Das Ziel.
export type TipMode = "argmaxLegacy" | "argmaxReweighted" | "ev";

export interface RunSpec {
  name: string;
  variant: VariantName;
  tipMode: TipMode;
  // Over/Under-2.5-Bedingung zusaetzlich auf die Score-Matrix legen. Der 1X2-Blend
  // korrigiert nur, WIE das Spiel ausgeht -- diese Bedingung korrigiert, wie viele Tore
  // dabei fallen. Genau das entscheidet ueber Exakt- und Tordifferenz-Punkte.
  useTotals?: boolean;
  // Staerke der Marktbedingungen im IPF: 0 = ignorieren, 1 = voll erzwingen.
  marketStrength?: number;
  // Gewicht der Formkurve. Default ist der produktive Wert aus xgForm.ts.
  xgFormWeight?: number;
  // "diff" = rohe xG-Differenz (Ist-Zustand), "residual" = Abweichung vom Normalniveau.
  formMode?: "diff" | "residual";
  // Matrixparameter. Ohne Angabe die produktiven Werte aus scoreMatrix.ts.
  rho?: number;
  drawBoost?: number;
}

export interface MatchEvaluation {
  season: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  actualHome: number;
  actualAway: number;
  actual: Outcome;
  lambdaHome: number;
  lambdaAway: number;
  modelProbs: OutcomeProbs;
  marketProbs: OutcomeProbs | null;
  finalProbs: OutcomeProbs;
  predicted: Outcome;
  tip: string;
  // Was das Modell fuer diesen Tipp an Punkten erwartet. Der Abstand zum tatsaechlichen
  // Punkteschnitt ist ein direkter Kalibrierungstest.
  expectedPoints: number;
  points: number;
  exactHit: boolean;
  rps: number;
  logLoss: number;
  brier: number;
}

export function toPerMatchMetrics(e: MatchEvaluation): PerMatchMetrics {
  return {
    predicted: e.predicted,
    actual: e.actual,
    exactHit: e.exactHit,
    points: e.points,
    expectedPoints: e.expectedPoints,
    rps: e.rps,
    logLoss: e.logLoss,
    brier: e.brier,
  };
}

export function evaluateRun(
  seasonContexts: SeasonContexts[],
  spec: RunSpec,
  scheme: ScoringScheme
): MatchEvaluation[] {
  const evaluations: MatchEvaluation[] = [];

  for (const season of seasonContexts) {
    for (const ctx of season.contexts) {
      const formWeight = spec.xgFormWeight ?? XG_FORM_WEIGHT;
      const residual = spec.formMode === "residual";
      const homeForm = residual ? ctx.homeFormResidual : ctx.homeForm;
      const awayForm = residual ? ctx.awayFormResidual : ctx.awayForm;
      const lambdaHome = ctx.baseLambdaHome * Math.exp(formWeight * homeForm);
      const lambdaAway = ctx.baseLambdaAway * Math.exp(formWeight * awayForm);

      const modelMatrix = buildDixonColesMatrix(lambdaHome, lambdaAway, {
        rho: spec.rho,
        drawBoost: spec.drawBoost,
      });
      const modelProbs = outcomeMasses(modelMatrix);
      const finalProbs = finalProbsFor(spec.variant, modelProbs, ctx.market1x2, season.trainBaseRate);

      // Marktbedingungen auf die Matrix legen. Mit nur der 1X2-Bedingung ist das
      // beweisbar identisch zu reweightToOutcomeMasses (siehe selfCheck.ts), die alten
      // Zahlen bleiben also erhalten; die Totals-Bedingung kommt additiv dazu.
      const constraints: MatrixConstraint[] = [];
      if (spec.tipMode !== "argmaxLegacy") {
        if (finalProbs !== modelProbs) {
          constraints.push(outcomeConstraint(modelMatrix.maxGoals, finalProbs));
        }
        if (spec.useTotals && ctx.totalsOverProb !== null) {
          constraints.push(totalOverConstraint(modelMatrix.maxGoals, 2.5, ctx.totalsOverProb));
        }
      }

      const tipMatrix =
        constraints.length > 0
          ? applyConstraints(modelMatrix, constraints, { strength: spec.marketStrength ?? 1 }).matrix
          : modelMatrix;

      let tip: string;
      let expectedPoints: number;
      if (spec.tipMode === "ev") {
        const choice = selectEvTip(tipMatrix, scheme);
        tip = choice.tip;
        expectedPoints = choice.expectedPoints;
      } else {
        tip = argmaxCell(tipMatrix);
        const [h, a] = tip.split(":").map(Number);
        expectedPoints = expectedPointsForTip(tipMatrix, h, a, scheme);
      }

      const [tipHome, tipAway] = tip.split(":").map(Number);

      evaluations.push({
        season: ctx.season,
        date: ctx.date,
        homeTeam: ctx.homeTeam,
        awayTeam: ctx.awayTeam,
        actualHome: ctx.actualHome,
        actualAway: ctx.actualAway,
        actual: ctx.actual,
        lambdaHome,
        lambdaAway,
        modelProbs,
        marketProbs: ctx.market1x2,
        finalProbs,
        predicted: argmaxOutcome(finalProbs),
        tip,
        expectedPoints,
        points: pointsFor(tipHome, tipAway, ctx.actualHome, ctx.actualAway, scheme),
        exactHit: tipHome === ctx.actualHome && tipAway === ctx.actualAway,
        rps: rankedProbabilityScore(finalProbs, ctx.actual),
        logLoss: logLoss(finalProbs, ctx.actual),
        brier: brierScore(finalProbs, ctx.actual),
      });
    }
  }

  return evaluations;
}

// Ohne Quoten faellt jede marktbasierte Variante auf das Modell zurueck. Dadurch bleiben
// alle Varianten auf exakt derselben Spielmenge vergleichbar -- Voraussetzung fuer die
// gepaarten Tests. runBacktest meldet, wie viele Spiele davon betroffen sind.
function finalProbsFor(
  variant: VariantName,
  model: OutcomeProbs,
  market: OutcomeProbs | null,
  baseRate: OutcomeProbs
): OutcomeProbs {
  if (variant === "baseRate") return baseRate;
  if (variant === "modelOnly" || market === null) return model;
  if (variant === "pureMarket") return market;
  return blendWithMarket(model, market, ODDS_BLEND_ALPHA);
}

export interface BacktestOptions {
  split?: SplitName;
  seasons?: string[];
  variant?: VariantName;
  tipMode?: TipMode;
  scheme?: ScoringScheme | string;
  includeEvaluations?: boolean;
}

export interface SeasonSummary {
  season: string;
  trainMatchCount: number;
  summary: MetricSummary;
}

export interface BacktestResult {
  seasons: string[];
  scheme: ScoringScheme;
  variant: VariantName;
  tipMode: TipMode;
  perSeason: SeasonSummary[];
  overall: MetricSummary;
  baselines: Record<VariantName, MetricSummary>;
  evaluations: MatchEvaluation[];
  matchesWithoutOdds: number;
  totalEvaluated: number;
}

export function runBacktest(opts: BacktestOptions = {}): BacktestResult {
  const seasons = opts.seasons ?? seasonsFor(opts.split ?? "all");
  const scheme = typeof opts.scheme === "object" ? opts.scheme : resolveScheme(opts.scheme);
  const variant = opts.variant ?? "modelOnly";
  const tipMode = opts.tipMode ?? "argmaxLegacy";

  const seasonContexts = buildContexts(seasons);
  const evaluations = evaluateRun(seasonContexts, { name: variant, variant, tipMode }, scheme);

  const bySeason = new Map<string, MatchEvaluation[]>();
  for (const e of evaluations) {
    const list = bySeason.get(e.season);
    if (list) list.push(e);
    else bySeason.set(e.season, [e]);
  }

  const perSeason: SeasonSummary[] = seasonContexts.map((s) => ({
    season: s.season,
    trainMatchCount: s.trainMatchCount,
    summary: summarize((bySeason.get(s.season) ?? []).map(toPerMatchMetrics)),
  }));

  const baselines = {} as Record<VariantName, MetricSummary>;
  for (const name of ALL_VARIANTS) {
    baselines[name] =
      name === variant
        ? summarize(evaluations.map(toPerMatchMetrics))
        : summarize(
            evaluateRun(seasonContexts, { name, variant: name, tipMode }, scheme).map(
              toPerMatchMetrics
            )
          );
  }

  return {
    seasons,
    scheme,
    variant,
    tipMode,
    perSeason,
    overall: summarize(evaluations.map(toPerMatchMetrics)),
    baselines,
    evaluations: opts.includeEvaluations ? evaluations : [],
    matchesWithoutOdds: evaluations.filter((e) => e.marketProbs === null).length,
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
  points: BootstrapResult;
  // Auf wie vielen Spielen weicht der abgegebene Tipp ueberhaupt ab. Spiele mit
  // identischem Tipp tragen null zur Punktedifferenz bei; ohne diese Zahl sieht ein
  // kleiner Mittelwert nach schwachem Effekt aus, obwohl er auf wenigen Spielen
  // konzentriert und dort gross sein kann.
  tipsDiffering: number;
  perSeasonPointsDiff: { season: string; diff: number }[];
}

// Gepaarter Vergleich zweier Laeufe auf exakt denselben Spielen. Das ist der einzige Weg,
// Unterschiede aufzuloesen, die kleiner sind als der Standardfehler der Trefferquote
// (1.01pp bei n=2448) -- und das sind hier praktisch alle.
export function compareRuns(
  seasonContexts: SeasonContexts[],
  specA: RunSpec,
  specB: RunSpec,
  scheme: ScoringScheme
): RunComparison {
  const evalA = evaluateRun(seasonContexts, specA, scheme);
  const evalB = evaluateRun(seasonContexts, specB, scheme);

  if (evalA.length !== evalB.length) {
    throw new Error("Laeufe haben unterschiedlich viele Spiele -- gepaarter Test unmoeglich");
  }

  let onlyA = 0;
  let onlyB = 0;
  let tipsDiffering = 0;
  const rpsDiffs: number[] = [];
  const pointsDiffs: number[] = [];
  const seasonTotals = new Map<string, number>();

  for (let i = 0; i < evalA.length; i++) {
    const ea = evalA[i];
    const eb = evalB[i];
    const aCorrect = ea.predicted === ea.actual;
    const bCorrect = eb.predicted === eb.actual;
    if (aCorrect && !bCorrect) onlyA++;
    else if (!aCorrect && bCorrect) onlyB++;
    if (ea.tip !== eb.tip) tipsDiffering++;

    // Niedriger ist beim RPS besser, deshalb umgedreht: positiv = A ist besser.
    rpsDiffs.push(eb.rps - ea.rps);
    const pointsDiff = ea.points - eb.points;
    pointsDiffs.push(pointsDiff);
    seasonTotals.set(ea.season, (seasonTotals.get(ea.season) ?? 0) + pointsDiff);
  }

  return {
    a: specA.name,
    b: specB.name,
    n: evalA.length,
    summaryA: summarize(evalA.map(toPerMatchMetrics)),
    summaryB: summarize(evalB.map(toPerMatchMetrics)),
    tendency: mcnemarExact(onlyA, onlyB),
    rps: pairedBootstrap(rpsDiffs),
    points: pairedBootstrap(pointsDiffs),
    tipsDiffering,
    perSeasonPointsDiff: [...seasonTotals.entries()].map(([season, diff]) => ({ season, diff })),
  };
}
