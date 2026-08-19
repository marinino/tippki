// Der vollstaendige Vorhersageweg, an einer Stelle.
//
// Die Pipeline ist bewusst marktfrei. Vorher mischte sie Buchmacherquoten in die
// 1X2-Massen und legte Totals- und Spread-Leitern als Nebenbedingungen auf die Matrix.
// Das lieferte gute Zahlen, aber sie gehoerten nicht dem Modell: gemessen ueber acht
// Saisons schlug der reine Markt jeden Blend, und in genau den Faellen, in denen Modell
// und Markt sich widersprachen, hatte systematisch der Markt recht. Solange die Quoten
// mitlaufen, ist nicht entscheidbar, ob eine Modelaenderung etwas taugt -- der Markt
// deckt sie zu.
//
// Ab hier ist der Markt ausschliesslich Massstab (src/eval/benchmarkOdds.ts) und niemals
// Eingabe. Was diese Datei ausgibt, stammt vollstaendig aus Teamstaerken, Formkurve und
// recherchiertem Spielkontext.
//
// Feste Reihenfolge:
//   1. Modell-Lambdas aus den gefitteten Staerken, multipliziert mit dem Formexponenten
//   2. geklammerte Korrektur aus dem recherchierten Spielkontext
//   3. Dixon-Coles-Matrix bauen und normalisieren
//   4. Preisblatt ueber alle Maerkte daraus ableiten

import type { LeagueModel } from "./teamStrength";
import type { OutcomeProbs } from "../eval/metrics";
import { XG_FORM_WEIGHT } from "./xgForm";
import { baseLambdas } from "./predictMatch";
import { buildPriceSheet, type PriceSheet, type PriceSheetOptions } from "./priceSheet";
import {
  DEFAULT_OUTCOME_TEMPERATURE,
  applyOutcomeTemperature,
  buildDixonColesMatrix,
  expectedGoals,
  outcomeMasses,
  type MatrixOptions,
  type ScoreMatrix,
} from "./scoreMatrix";
import {
  applyAdjustment,
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
  // Recherchierter Spielkontext (Ausfaelle, Belastung, Motivation) als geklammerte
  // Korrektur der Torerwartungen.
  llmContext?: LlmMatchContext | null;
  llmOptions?: LlmAdjustmentOptions;
  outcomeTemperature?: number;
  matrixOptions?: MatrixOptions;
  priceSheetOptions?: PriceSheetOptions;
}

export interface PipelineOutput {
  // Erwartete Tore aus der fertigen Matrix.
  expectedHomeGoals: number;
  expectedAwayGoals: number;
  // Die Lambdas, die in die Matrix gingen -- fuer Diagnose und Vergleich.
  lambdaHome: number;
  lambdaAway: number;
  probs: OutcomeProbs;
  matrix: ScoreMatrix;
  prices: PriceSheet;
  homeIsEstimated: boolean;
  awayIsEstimated: boolean;
  // null, wenn kein Kontext vorlag oder er keine Faktoren enthielt.
  llmAdjustment: LlmAdjustment | null;
  // Torerwartungen VOR der LLM-Korrektur -- fuer den gepaarten Vorwaertsvergleich.
  formLambdaHome: number;
  formLambdaAway: number;
}

export function predictPipeline(input: PipelineInput): PipelineOutput {
  const base = baseLambdas(input.model, input.homeTeam, input.awayTeam);
  const formLambdaHome = base.lambdaHome * Math.exp(XG_FORM_WEIGHT * (input.homeForm ?? 0));
  const formLambdaAway = base.lambdaAway * Math.exp(XG_FORM_WEIGHT * (input.awayForm ?? 0));

  let llmAdjustment: LlmAdjustment | null = null;
  let lambdaHome = formLambdaHome;
  let lambdaAway = formLambdaAway;

  if (input.llmContext && input.llmContext.keyFactors.length > 0) {
    const applied = applyAdjustment(
      formLambdaHome,
      formLambdaAway,
      toLlmAdjustment(input.llmContext, input.llmOptions)
    );
    lambdaHome = applied.lambdaHome;
    lambdaAway = applied.lambdaAway;
    llmAdjustment = applied.adjustment;
  }

  const matrix = buildDixonColesMatrix(lambdaHome, lambdaAway, input.matrixOptions);
  // Schritt 4: Kalibrierungstemperatur. Auf der Matrix, damit das Preisblatt darunter
  // konsistent bleibt -- Begruendung in scoreMatrix.ts.
  applyOutcomeTemperature(matrix, input.outcomeTemperature ?? DEFAULT_OUTCOME_TEMPERATURE);
  const expected = expectedGoals(matrix);

  return {
    expectedHomeGoals: expected.home,
    expectedAwayGoals: expected.away,
    lambdaHome,
    lambdaAway,
    probs: outcomeMasses(matrix),
    matrix,
    prices: buildPriceSheet(matrix, input.priceSheetOptions),
    homeIsEstimated: base.homeIsEstimated,
    awayIsEstimated: base.awayIsEstimated,
    llmAdjustment,
    formLambdaHome,
    formLambdaAway,
  };
}
