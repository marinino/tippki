// Guardrails zwischen recherchierten Fakten und der Torerwartung.
//
// Der Layer greift eine Informationsluecke an, die real ist -- aber er tut es mit einer
// schlechteren Basis als der Markt. Deshalb darf er nur nachjustieren, nie umstossen.
// Vier Schichten, in dieser Reihenfolge.

import type { OutcomeProbs } from "../eval/metrics";
import { argmaxOutcome } from "../eval/metrics";
import { buildDixonColesMatrix, outcomeMasses } from "../model/scoreMatrix";
import { aggregateFactors, toLambdaExponents, type AggregatedDelta } from "./factMapping";
import type { LlmMatchContext } from "./matchContext";

// Globaler Daempfungsfaktor. Bewusst unter 1: die Fakten-Gewichte in factMapping.ts sind
// Priors ohne Messung, und solange kein Vorwaertsbefund existiert, ist Zurueckhaltung die
// richtige Voreinstellung.
export const DEFAULT_LLM_GAIN = 0.6;

// Harte Obergrenze je Seite, nach der Daempfung. 0.15 im Log-Raum sind rund +/-16% auf die
// Torerwartung -- etwa die Groessenordnung, die ein fehlender Schluesselspieler plausibel
// ausmacht, und klein genug, dass eine Falschmeldung keinen Schaden anrichtet.
export const DEFAULT_LLM_MAX_LOG_ADJUSTMENT = 0.15;

export interface LlmAdjustment {
  homeLogAdj: number;
  awayLogAdj: number;
  // Nachvollziehbarkeit fuer Log und UI.
  aggregated: AggregatedDelta;
  // Wie stark die Favoritensicherung zurueckgedreht hat: 1 = unveraendert, 0 = blockiert.
  shrinkFactor: number;
  blocked: boolean;
}

export interface LlmAdjustmentOptions {
  gain?: number;
  maxLogAdjustment?: number;
}

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

// Schritt 1-3: Fakten zusammenfassen, daempfen, klammern.
export function toLlmAdjustment(
  context: LlmMatchContext,
  options: LlmAdjustmentOptions = {}
): LlmAdjustment {
  const gain = options.gain ?? DEFAULT_LLM_GAIN;
  const limit = options.maxLogAdjustment ?? DEFAULT_LLM_MAX_LOG_ADJUSTMENT;

  const aggregated = aggregateFactors(context.keyFactors);
  const exponents = toLambdaExponents(aggregated);

  return {
    homeLogAdj: clamp(exponents.home * gain, limit),
    awayLogAdj: clamp(exponents.away * gain, limit),
    aggregated,
    shrinkFactor: 1,
    blocked: false,
  };
}

export interface AppliedAdjustment {
  lambdaHome: number;
  lambdaAway: number;
  adjustment: LlmAdjustment;
}

const SHRINK_STEPS = 12;

// Schritt 4: Favoritensicherung.
//
// Das LLM darf niemals allein aus einem Heimsieg einen Auswaertssieg machen. Kippt die
// wahrscheinlichste Tendenz, wird die Korrektur per Binaersuche so weit zurueckgedreht,
// bis sie es nicht mehr tut; kippt sie selbst beim kleinsten Schritt, wird gar nichts
// angewandt.
//
// Begruendung: eine Tendenzumkehr ist die folgenreichste Einzelaenderung, die dieser Layer
// ausloesen kann, und seine Informationsbasis rechtfertigt sie nicht. Ausfaelle verschieben
// Wahrscheinlichkeiten, sie drehen keine Spiele.
export function applyWithGuardrails(
  baseLambdaHome: number,
  baseLambdaAway: number,
  adjustment: LlmAdjustment,
  matrixOptions?: Parameters<typeof buildDixonColesMatrix>[2]
): AppliedAdjustment {
  const noChange =
    adjustment.homeLogAdj === 0 && adjustment.awayLogAdj === 0
      ? { lambdaHome: baseLambdaHome, lambdaAway: baseLambdaAway, adjustment }
      : null;
  if (noChange) return noChange;

  const baseOutcome = argmaxOutcome(
    outcomeMasses(buildDixonColesMatrix(baseLambdaHome, baseLambdaAway, matrixOptions))
  );

  function withFactor(factor: number): { lambdaHome: number; lambdaAway: number; outcome: ReturnType<typeof argmaxOutcome> } {
    const lambdaHome = baseLambdaHome * Math.exp(adjustment.homeLogAdj * factor);
    const lambdaAway = baseLambdaAway * Math.exp(adjustment.awayLogAdj * factor);
    return {
      lambdaHome,
      lambdaAway,
      outcome: argmaxOutcome(outcomeMasses(buildDixonColesMatrix(lambdaHome, lambdaAway, matrixOptions))),
    };
  }

  const full = withFactor(1);
  if (full.outcome === baseOutcome) {
    return { lambdaHome: full.lambdaHome, lambdaAway: full.lambdaAway, adjustment };
  }

  // Binaersuche nach dem groessten Faktor, der die Tendenz nicht kippt.
  let low = 0;
  let high = 1;
  for (let i = 0; i < SHRINK_STEPS; i++) {
    const mid = (low + high) / 2;
    if (withFactor(mid).outcome === baseOutcome) low = mid;
    else high = mid;
  }

  const smallest = withFactor(low);
  if (low <= 0 || smallest.outcome !== baseOutcome) {
    return {
      lambdaHome: baseLambdaHome,
      lambdaAway: baseLambdaAway,
      adjustment: { ...adjustment, shrinkFactor: 0, blocked: true },
    };
  }

  return {
    lambdaHome: smallest.lambdaHome,
    lambdaAway: smallest.lambdaAway,
    adjustment: { ...adjustment, shrinkFactor: low },
  };
}

// Fuer die UI: ein Satz je Faktor, mit Quelle.
export function describeFactors(context: LlmMatchContext): string[] {
  return context.keyFactors.map((f) => {
    const side = f.team === "home" ? "Heim" : "Auswärts";
    const certainty =
      f.certainty === "confirmed" ? "bestätigt" : f.certainty === "likely" ? "wahrscheinlich" : "gemeldet";
    return `${side}: ${f.subject} — ${f.note} (${certainty})`;
  });
}

export function outcomeProbsOf(lambdaHome: number, lambdaAway: number): OutcomeProbs {
  return outcomeMasses(buildDixonColesMatrix(lambdaHome, lambdaAway));
}
