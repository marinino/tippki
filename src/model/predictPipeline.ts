// Der vollstaendige Vorhersageweg, an einer Stelle.
//
// Vorher war die Reihenfolge ueber drei Aufrufstellen verteilt (predictions/route.ts,
// simulate/route.ts, scripts/predict.ts) und in mindestens einer davon falsch: die
// 1X2-Balken wurden mit den Marktquoten geblendet, der angezeigte Tipp kam aber weiter
// aus der UNGEBLENDETEN Modellmatrix. Die beste verfuegbare Information landete also
// nirgends im Tipp. Diese Datei besitzt die Reihenfolge, damit das nicht wieder passiert.

import type { LeagueModel } from "./teamStrength";
import type { OutcomeProbs } from "../eval/metrics";
import type { ScoringScheme } from "../eval/scoringScheme";
import { resolveScheme } from "../eval/scoringScheme";
import { XG_FORM_WEIGHT } from "./xgForm";
import { baseLambdas } from "./predictMatch";
import { ODDS_BLEND_ALPHA, blendWithMarket } from "./marketOdds";
import {
  buildDixonColesMatrix,
  expectedGoals,
  outcomeMasses,
  type MatrixOptions,
  type ScoreMatrix,
} from "./scoreMatrix";
import {
  applyConstraints,
  goalDifferenceConstraintFromProbs,
  outcomeConstraint,
  totalGoalsConstraintFromProbs,
  type MatrixConstraint,
} from "./marketConstraints";
import { selectEvTip, type TipChoice } from "./tipSelector";
import {
  applyWithGuardrails,
  toLlmAdjustment,
  type LlmAdjustment,
  type LlmAdjustmentOptions,
} from "../llm/llmAdjustment";
import type { LlmMatchContext } from "../llm/matchContext";

export interface PipelineInput {
  model: LeagueModel;
  homeTeam: string;
  awayTeam: string;
  // Formkurve je Team (xG-Differenz der letzten Spiele, oder Tordifferenz im Simulator).
  homeForm?: number;
  awayForm?: number;
  // Entvigte Marktwahrscheinlichkeiten, falls vorhanden.
  market1x2?: OutcomeProbs | null;
  // Randverteilung der Torsumme bzw. der Tordifferenz aus den Markt-Leitern.
  marketTotals?: { line: number; overProb: number }[] | null;
  marketSpread?: { line: number; homeProb: number }[] | null;
  // Recherchierter Spielkontext (Ausfaelle, Belastung, Motivation) als geklammerte
  // Korrektur der Torerwartungen.
  llmContext?: LlmMatchContext | null;
  llmOptions?: LlmAdjustmentOptions;
  scheme?: ScoringScheme;
  oddsBlendAlpha?: number;
  marketStrength?: number;
  matrixOptions?: MatrixOptions;
}

export interface PipelineOutput {
  // Erwartete Tore NACH allen Marktbedingungen, aus der Matrix gerechnet.
  expectedHomeGoals: number;
  expectedAwayGoals: number;
  // Die rohen Modell-Lambdas davor -- fuer Diagnose und Vergleich.
  modelLambdaHome: number;
  modelLambdaAway: number;
  modelProbs: OutcomeProbs;
  finalProbs: OutcomeProbs;
  matrix: ScoreMatrix;
  tip: TipChoice;
  homeIsEstimated: boolean;
  awayIsEstimated: boolean;
  marketApplied: boolean;
  // Welche Marktbedingungen tatsaechlich gegriffen haben -- fuer UI und Diagnose.
  marketConstraints: string[];
  marketConverged: boolean;
  // null, wenn kein Kontext vorlag oder er keine Faktoren enthielt.
  llmAdjustment: LlmAdjustment | null;
  // Torerwartungen VOR der LLM-Korrektur -- fuer den gepaarten Vorwaertsvergleich.
  formLambdaHome: number;
  formLambdaAway: number;
}

// Feste Reihenfolge:
//   1. Modell-Lambdas aus den gefitteten Staerken, multipliziert mit dem Formexponenten
//   2. (Phase 2) geometrische Mischung mit markt-implizierten Lambdas
//   3. (Phase 3) geklammerte LLM-Korrektur
//   4. Dixon-Coles-Matrix bauen und normalisieren
//   5. Falls Markt vorhanden: 1X2-Massen mischen, dann die Matrix darauf umgewichten
//   6. Tipp nach Punkte-Erwartungswert auf der korrigierten Matrix waehlen
export function predictPipeline(input: PipelineInput): PipelineOutput {
  const scheme = input.scheme ?? resolveScheme(null);
  const alpha = input.oddsBlendAlpha ?? ODDS_BLEND_ALPHA;

  const base = baseLambdas(input.model, input.homeTeam, input.awayTeam);
  const formLambdaHome = base.lambdaHome * Math.exp(XG_FORM_WEIGHT * (input.homeForm ?? 0));
  const formLambdaAway = base.lambdaAway * Math.exp(XG_FORM_WEIGHT * (input.awayForm ?? 0));

  // Schritt 3: geklammerte Korrektur aus dem recherchierten Spielkontext. Wirkt VOR der
  // Matrix und damit vor den Marktbedingungen -- die duerfen sie anschliessend
  // ueberstimmen, denn der Markt kennt Ausfaelle ohnehin.
  let llmAdjustment: LlmAdjustment | null = null;
  let modelLambdaHome = formLambdaHome;
  let modelLambdaAway = formLambdaAway;

  if (input.llmContext && input.llmContext.keyFactors.length > 0) {
    const applied = applyWithGuardrails(
      formLambdaHome,
      formLambdaAway,
      toLlmAdjustment(input.llmContext, input.llmOptions),
      input.matrixOptions
    );
    modelLambdaHome = applied.lambdaHome;
    modelLambdaAway = applied.lambdaAway;
    llmAdjustment = applied.adjustment;
  }

  const modelMatrix = buildDixonColesMatrix(
    modelLambdaHome,
    modelLambdaAway,
    input.matrixOptions
  );
  const modelProbs = outcomeMasses(modelMatrix);

  const market = input.market1x2 ?? null;
  const finalProbs = market ? blendWithMarket(modelProbs, market, alpha) : modelProbs;

  // Schritt 5: alle Marktinformationen wandern als Nebenbedingungen in die Matrix, damit
  // sie den Tipp erreichen. Der 1X2-Blend korrigiert, WIE das Spiel ausgeht; die Totals-
  // und Spread-Leitern korrigieren, wie viele Tore fallen und wie hoch der Sieg ausfaellt.
  // Genau diese beiden Dimensionen entscheiden ueber Exakt- und Tordifferenz-Punkte, und
  // der 1X2-Markt sagt darueber nichts.
  const constraints: MatrixConstraint[] = [];
  const applied: string[] = [];

  if (market) {
    constraints.push(outcomeConstraint(modelMatrix.maxGoals, finalProbs));
    applied.push("1X2");
  }
  if (input.marketTotals && input.marketTotals.length >= 2) {
    const totals = totalGoalsConstraintFromProbs(modelMatrix.maxGoals, input.marketTotals);
    if (totals) {
      constraints.push(totals);
      applied.push(totals.name);
    }
  }
  if (input.marketSpread && input.marketSpread.length >= 2) {
    const spread = goalDifferenceConstraintFromProbs(modelMatrix.maxGoals, input.marketSpread);
    if (spread) {
      constraints.push(spread);
      applied.push(spread.name);
    }
  }

  const fit =
    constraints.length > 0
      ? applyConstraints(modelMatrix, constraints, { strength: input.marketStrength ?? 1 })
      : null;
  const matrix = fit ? fit.matrix : modelMatrix;
  const expected = expectedGoals(matrix);

  return {
    // Aus der fertigen Matrix, nicht die rohen Modell-Lambdas: nach den Marktbedingungen
    // gelten die nicht mehr, und daneben angezeigt wuerden sie dem Tipp widersprechen.
    expectedHomeGoals: expected.home,
    expectedAwayGoals: expected.away,
    modelLambdaHome,
    modelLambdaAway,
    modelProbs,
    // Nach dem Fit koennen die 1X2-Massen minimal von finalProbs abweichen, wenn sich
    // Bedingungen widersprechen. Berichtet wird, was wirklich in der Matrix steht.
    finalProbs: fit ? outcomeMasses(matrix) : finalProbs,
    matrix,
    tip: selectEvTip(matrix, scheme),
    homeIsEstimated: base.homeIsEstimated,
    awayIsEstimated: base.awayIsEstimated,
    marketApplied: market !== null,
    marketConstraints: applied,
    marketConverged: fit ? fit.converged : true,
    llmAdjustment,
    formLambdaHome,
    formLambdaAway,
  };
}
