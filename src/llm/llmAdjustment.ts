// Guardrails zwischen recherchierten Fakten und der Torerwartung.
//
// Der Layer greift eine Informationsluecke an, die real ist -- aber er tut es mit einer
// schlechteren Basis als der Markt. Deshalb darf er nur nachjustieren, nie umstossen.
// Drei Schichten, in dieser Reihenfolge: daempfen, klammern, anwenden.
//
// ENTFERNT am 2026-08-19: die Favoritensicherung, die eine Korrektur zurueckgedreht oder
// verworfen hat, sobald sie die wahrscheinlichste Tendenz gekippt haette. Sie war ein
// Ueberbleibsel der Kicktipp-Zeit, als das Tendenz-Etikett das Produkt war. Seit dem Umbau
// wird an der VERTEILUNG gemessen (RPS, LogLoss) -- siehe die Begruendung oben in
// eval/metrics.ts, die die Trefferquote ausdruecklich absetzt. Eine Tendenzumkehr ist darin
// nichts Besonderes, nur eine Verschiebung wie jede andere.
//
// Gemessen vor dem Ausbau, volle erlaubte Korrektur gegen die Heimmannschaft:
//
//   Ausgangslage      vorher            ohne Sicherung     mit Sicherung      Faktor
//   klarer Favorit    63,6/22,7/13,7    53,6/26,3/20,1     53,6/26,3/20,1     greift nicht
//   deutlich          53,3/26,4/20,3    43,2/28,6/28,2     43,2/28,6/28,2     greift nicht
//   leichter Favorit  43,6/28,7/27,7    34,0/29,3/36,7     35,3/29,3/35,3     0,85
//   knapp             38,0/29,6/32,4    28,9/29,2/41,9     35,2/29,6/35,2     0,30
//   Gleichstand       35,3/29,5/35,3    26,4/28,6/45,0     35,3/29,5/35,3     0,00
//
// Sie griff also ausgerechnet dort am haertesten, wo das Etikett am wenigsten bedeutet: im
// Gleichstand hat sie die GESAMTE Korrektur verworfen, um einen Muenzwurf zu schuetzen --
// und dabei eine reale Verschiebung von 35,3 auf 26,4 mitgenommen. Vor einer Falschmeldung
// schuetzt ohnehin die Klammerung: sie begrenzt die Bewegung auf rund zehn Prozentpunkte,
// egal was recherchiert wurde. Wer sie wieder einbauen will, braucht ein Argument, das
// diese Tabelle schlaegt.

import type { OutcomeProbs } from "../eval/metrics";
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
  };
}

export interface AppliedAdjustment {
  lambdaHome: number;
  lambdaAway: number;
  adjustment: LlmAdjustment;
}

// Schritt 3: anwenden. Die Korrektur wirkt multiplikativ auf die Torerwartung, weil sie im
// Log-Raum gedacht ist -- "15 Prozent weniger" ist unabhaengig davon, ob eine Mannschaft
// 0,8 oder 2,4 Tore erwarten laesst. Nach der Klammerung steht die Groesse bereits fest;
// hier wird nichts mehr entschieden.
export function applyAdjustment(
  baseLambdaHome: number,
  baseLambdaAway: number,
  adjustment: LlmAdjustment
): AppliedAdjustment {
  return {
    lambdaHome: baseLambdaHome * Math.exp(adjustment.homeLogAdj),
    lambdaAway: baseLambdaAway * Math.exp(adjustment.awayLogAdj),
    adjustment,
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
