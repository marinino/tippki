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
  outcomeMasses,
  reweightToOutcomeMasses,
  type MatrixOptions,
  type ScoreMatrix,
} from "./scoreMatrix";
import { selectEvTip, type TipChoice } from "./tipSelector";

export interface PipelineInput {
  model: LeagueModel;
  homeTeam: string;
  awayTeam: string;
  // Formkurve je Team (xG-Differenz der letzten Spiele, oder Tordifferenz im Simulator).
  homeForm?: number;
  awayForm?: number;
  // Entvigte Marktwahrscheinlichkeiten, falls vorhanden.
  market1x2?: OutcomeProbs | null;
  scheme?: ScoringScheme;
  oddsBlendAlpha?: number;
  matrixOptions?: MatrixOptions;
}

export interface PipelineOutput {
  expectedHomeGoals: number;
  expectedAwayGoals: number;
  modelProbs: OutcomeProbs;
  finalProbs: OutcomeProbs;
  matrix: ScoreMatrix;
  tip: TipChoice;
  homeIsEstimated: boolean;
  awayIsEstimated: boolean;
  marketApplied: boolean;
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
  const expectedHomeGoals = base.lambdaHome * Math.exp(XG_FORM_WEIGHT * (input.homeForm ?? 0));
  const expectedAwayGoals = base.lambdaAway * Math.exp(XG_FORM_WEIGHT * (input.awayForm ?? 0));

  const modelMatrix = buildDixonColesMatrix(
    expectedHomeGoals,
    expectedAwayGoals,
    input.matrixOptions
  );
  const modelProbs = outcomeMasses(modelMatrix);

  const market = input.market1x2 ?? null;
  const finalProbs = market ? blendWithMarket(modelProbs, market, alpha) : modelProbs;
  // Schritt 5: die Marktkorrektur wandert in die Matrix, damit sie auch den Tipp erreicht.
  const matrix = market ? reweightToOutcomeMasses(modelMatrix, finalProbs) : modelMatrix;

  return {
    expectedHomeGoals,
    expectedAwayGoals,
    modelProbs,
    finalProbs,
    matrix,
    tip: selectEvTip(matrix, scheme),
    homeIsEstimated: base.homeIsEstimated,
    awayIsEstimated: base.awayIsEstimated,
    marketApplied: market !== null,
  };
}
