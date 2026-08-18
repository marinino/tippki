// Reliability-Diagramm: sagt das Modell "30 Prozent", tritt der Fall dann auch in rund
// 30 Prozent der Faelle ein?
//
// Warum das hier fehlte: der Backtest berichtet bisher RPS, LogLoss und Brier -- alles
// Skalare. Sie sagen, DASS die Kalibrierung nicht stimmt, aber nicht, WO. Ein Modell,
// das bei hohen Wahrscheinlichkeiten uebermuetig und bei niedrigen zu vorsichtig ist,
// hat denselben Brier-Score wie eines, das durchgehend leicht daneben liegt.

import type { Outcome, OutcomeProbs } from "./metrics";

export interface CalibrationBin {
  from: number;
  to: number;
  n: number;
  // Mittlere vorhergesagte Wahrscheinlichkeit in dieser Klasse.
  meanPredicted: number;
  // Anteil der Faelle, in denen der Ausgang tatsaechlich eintrat.
  observed: number;
}

export interface CalibrationResult {
  bins: CalibrationBin[];
  // Nach Klassenbesetzung gewichtete mittlere Abweichung |observed - predicted|.
  // Das ist der Expected Calibration Error, die uebliche Ein-Zahl-Zusammenfassung.
  expectedCalibrationError: number;
  totalPoints: number;
}

// Jedes Spiel liefert DREI Datenpunkte: P(H) mit Eintritt ja/nein, ebenso P(U) und
// P(A). Das ist die uebliche Auswertung fuer mehrklassige Prognosen und nutzt dreimal
// so viele Punkte wie eine Beschraenkung auf den jeweiligen Favoriten -- bei 2448
// Spielen also 7344 statt 2448.
export function calibrationBins(
  rows: { probs: OutcomeProbs; actual: Outcome }[],
  binCount = 10
): CalibrationResult {
  const sums = Array.from({ length: binCount }, () => ({ n: 0, predicted: 0, hits: 0 }));

  for (const row of rows) {
    const points: [number, boolean][] = [
      [row.probs.homeWinProb, row.actual === "H"],
      [row.probs.drawProb, row.actual === "D"],
      [row.probs.awayWinProb, row.actual === "A"],
    ];
    for (const [p, hit] of points) {
      // p === 1 landet sonst in einer Klasse, die es nicht gibt.
      const index = Math.min(binCount - 1, Math.floor(p * binCount));
      sums[index].n++;
      sums[index].predicted += p;
      if (hit) sums[index].hits++;
    }
  }

  const bins: CalibrationBin[] = sums.map((s, i) => ({
    from: i / binCount,
    to: (i + 1) / binCount,
    n: s.n,
    meanPredicted: s.n > 0 ? s.predicted / s.n : (i + 0.5) / binCount,
    observed: s.n > 0 ? s.hits / s.n : 0,
  }));

  const totalPoints = bins.reduce((acc, b) => acc + b.n, 0);
  const expectedCalibrationError =
    totalPoints === 0
      ? 0
      : bins.reduce((acc, b) => acc + (b.n / totalPoints) * Math.abs(b.observed - b.meanPredicted), 0);

  return { bins, expectedCalibrationError, totalPoints };
}
