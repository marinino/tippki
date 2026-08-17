// Auswahl des abzugebenden Tipps.
//
// Bisher wurde die wahrscheinlichste einzelne Zelle der Score-Matrix getippt (argmax).
// Unter einem Punkteschema ist das nachweislich der falsche Tipp: gesucht ist nicht das
// wahrscheinlichste Ergebnis, sondern das mit dem hoechsten PUNKTE-Erwartungswert.
//
//   E[Punkte(tipp)] = SUM ueber alle Ergebnisse e von P(e) * Punkte(tipp, e)
//
// Bei Kicktipp-Standard 4/3/2 dominiert der Tendenz-Term (2 Punkte auf ~50%
// Wahrscheinlichkeit) den Exakt-Term (4 Punkte auf ~10%) deutlich. Der optimale Tipp ist
// deshalb fast immer das modale Ergebnis INNERHALB der wahrscheinlichsten Tendenz --
// also 1:0, 2:1, 1:1, 2:0. Wenig Varianz in den Tipps ist die Signatur eines
// funktionierenden EV-Selektors, kein Defekt.

import type { ScoringScheme } from "../eval/scoringScheme";
import { pointsFor } from "../eval/scoringScheme";
import { argmaxCell, type ScoreMatrix } from "./scoreMatrix";

export interface TipChoice {
  tip: string;
  tipHome: number;
  tipAway: number;
  expectedPoints: number;
  runnerUpTip: string;
  runnerUpExpectedPoints: number;
  // Der alte Argmax-Tipp -- fuer Vergleich im Backtest und als Zusatzinfo in der UI.
  argmaxCellTip: string;
}

// Naive Referenz: laeuft ueber alle Ergebniszellen und summiert P(e) * Punkte(tipp, e).
// Wird nicht im Produktivpfad verwendet, sondern dient selectEvTip als Orakel im
// Self-Check -- die geschlossene Form dort ist schnell, aber leicht falsch zu schreiben.
export function expectedPointsForTip(
  m: ScoreMatrix,
  tipHome: number,
  tipAway: number,
  scheme: ScoringScheme
): number {
  const size = m.maxGoals + 1;
  let ev = 0;

  for (let h = 0; h <= m.maxGoals; h++) {
    for (let a = 0; a <= m.maxGoals; a++) {
      const p = m.cells[h * size + a];
      if (p === 0) continue;
      ev += p * pointsFor(tipHome, tipAway, h, a, scheme);
    }
  }

  return ev;
}

interface MatrixAggregates {
  massHome: number;
  massDraw: number;
  massAway: number;
  // diffMass[d + maxGoals] = Wahrscheinlichkeit, dass die Tordifferenz genau d betraegt.
  diffMass: Float64Array;
}

function aggregate(m: ScoreMatrix): MatrixAggregates {
  const size = m.maxGoals + 1;
  const diffMass = new Float64Array(2 * m.maxGoals + 1);
  let massHome = 0;
  let massDraw = 0;
  let massAway = 0;

  for (let h = 0; h <= m.maxGoals; h++) {
    for (let a = 0; a <= m.maxGoals; a++) {
      const p = m.cells[h * size + a];
      diffMass[h - a + m.maxGoals] += p;
      if (h > a) massHome += p;
      else if (h === a) massDraw += p;
      else massAway += p;
    }
  }

  return { massHome, massDraw, massAway, diffMass };
}

// Geschlossene Form fuer den Erwartungswert eines einzelnen Tipps, O(1) nach der
// Aggregation. Die Zerlegung nutzt aus, dass die drei Punktstufen disjunkte
// Ereignismengen sind:
//
//   exakt              -> P(h,a)
//   gleiche Differenz  -> diffMass[d] - P(h,a)          (nur bei d != 0)
//   gleiche Tendenz    -> massTendenz(d) - diffMass[d]
//   falsch             -> 1 - massTendenz(d)
function closedFormEv(
  agg: MatrixAggregates,
  maxGoals: number,
  cellProb: number,
  tipHome: number,
  tipAway: number,
  scheme: ScoringScheme
): number {
  const d = tipHome - tipAway;

  if (d === 0) {
    // Bei einem Unentschieden-Tipp gibt es keine Tordifferenz-Stufe: gleiche Differenz
    // bedeutet hier gleiches Ergebnis, und das ist bereits der Exakt-Fall. Wer hier
    // versehentlich gd * (diffMass[0] - P) schreibt, ueberbewertet jeden Remis-Tipp --
    // der Selektor empfiehlt dann flaechendeckend 1:1. Genau derselbe Fallstrick wie in
    // pointsFor().
    return (
      scheme.exact * cellProb +
      scheme.tendency * (agg.massDraw - cellProb) +
      scheme.wrong * (1 - agg.massDraw)
    );
  }

  const massTendency = d > 0 ? agg.massHome : agg.massAway;
  const massDiff = agg.diffMass[d + maxGoals];

  return (
    scheme.exact * cellProb +
    scheme.goalDifference * (massDiff - cellProb) +
    scheme.tendency * (massTendency - massDiff) +
    scheme.wrong * (1 - massTendency)
  );
}

// Waehlt den Tipp mit dem hoechsten Punkte-Erwartungswert. Kandidaten sind alle
// Ergebnisse bis maxTipGoals; hoehere Ergebnisse zu tippen ist unter jedem sinnvollen
// Schema dominiert, weil sowohl ihre Exakt- als auch ihre Differenzwahrscheinlichkeit
// verschwindet.
export function selectEvTip(
  m: ScoreMatrix,
  scheme: ScoringScheme,
  maxTipGoals = m.maxGoals
): TipChoice {
  const agg = aggregate(m);
  const size = m.maxGoals + 1;
  const limit = Math.min(maxTipGoals, m.maxGoals);

  let bestEv = -Infinity;
  let bestHome = 0;
  let bestAway = 0;
  let secondEv = -Infinity;
  let secondHome = 0;
  let secondAway = 0;

  for (let h = 0; h <= limit; h++) {
    for (let a = 0; a <= limit; a++) {
      const ev = closedFormEv(agg, m.maxGoals, m.cells[h * size + a], h, a, scheme);

      if (ev > bestEv) {
        secondEv = bestEv;
        secondHome = bestHome;
        secondAway = bestAway;
        bestEv = ev;
        bestHome = h;
        bestAway = a;
      } else if (ev > secondEv) {
        secondEv = ev;
        secondHome = h;
        secondAway = a;
      }
    }
  }

  return {
    tip: `${bestHome}:${bestAway}`,
    tipHome: bestHome,
    tipAway: bestAway,
    expectedPoints: bestEv,
    runnerUpTip: `${secondHome}:${secondAway}`,
    runnerUpExpectedPoints: secondEv,
    argmaxCellTip: argmaxCell(m),
  };
}
