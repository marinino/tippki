import type { BacktestResult } from "../types";
import { num } from "../lib/format";
import styles from "./CalibrationChart.module.css";

const W = 260;
const H = 260;
const PAD = 30;

// Reliability-Diagramm. Auf der Diagonale ist das Modell perfekt kalibriert; ein Punkt
// darunter heisst "sagt oefter voraus, als eintritt" (uebermuetig), darueber das
// Gegenteil.
//
// Der bisherige Kalibrierungshinweis im Backtest war ein Satz Prosa ueber die Luecke
// zwischen erwarteten und geholten Punkten. Der sagt, DASS etwas nicht stimmt -- hier
// steht, in welchem Wahrscheinlichkeitsbereich.
export function CalibrationChart({ calibration }: { calibration: BacktestResult["calibration"] }) {
  if (!calibration || calibration.bins.length === 0) return null;

  const filled = calibration.bins.filter((b) => b.n > 0);
  if (filled.length < 2) return null;

  const maxN = Math.max(...filled.map((b) => b.n));
  const x = (p: number) => PAD + p * (W - PAD * 2);
  const y = (p: number) => H - PAD - p * (H - PAD * 2);

  const path = filled.map((b) => `${x(b.meanPredicted)},${y(b.observed)}`).join(" ");

  return (
    <figure className={styles.figure}>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.svg} role="img"
        aria-label={`Kalibrierungskurve über ${calibration.totalPoints} Prognosepunkte, mittlerer Kalibrierungsfehler ${num(calibration.expectedCalibrationError * 100, 1)} Prozentpunkte`}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={x(t)} y1={y(0)} x2={x(t)} y2={y(1)} className={styles.gridline} />
            <line x1={x(0)} y1={y(t)} x2={x(1)} y2={y(t)} className={styles.gridline} />
          </g>
        ))}

        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} className={styles.diagonal} />

        <polyline points={path} className={styles.curve} />

        {filled.map((b) => (
          <circle
            key={b.from}
            cx={x(b.meanPredicted)}
            cy={y(b.observed)}
            // Flaeche proportional zur Klassenbesetzung: eine Klasse mit 40 Punkten
            // darf nicht so schwer wiegen wie eine mit 2000.
            r={3 + 4 * Math.sqrt(b.n / maxN)}
            className={styles.point}
          >
            <title>
              {`${Math.round(b.from * 100)}–${Math.round(b.to * 100)}%: vorhergesagt ${num(b.meanPredicted * 100, 1)}%, eingetreten ${num(b.observed * 100, 1)}% (n=${b.n})`}
            </title>
          </circle>
        ))}

        {[0, 0.5, 1].map((t) => (
          <g key={`lab-${t}`}>
            <text x={x(t)} y={H - PAD + 14} className={styles.tick} textAnchor="middle">
              {Math.round(t * 100)}
            </text>
            <text x={PAD - 8} y={y(t) + 3} className={styles.tick} textAnchor="end">
              {Math.round(t * 100)}
            </text>
          </g>
        ))}
      </svg>

      <figcaption className={styles.caption}>
        <span className={styles.axisX}>vorhergesagt %</span>
        <span className={styles.axisY}>eingetreten %</span>
        <span>
          Mittlerer Kalibrierungsfehler{" "}
          <strong className={styles.ece}>
            {num(calibration.expectedCalibrationError * 100, 1)} pp
          </strong>{" "}
          über {calibration.totalPoints.toLocaleString("de-DE")} Prognosepunkte. Punkte auf der
          Diagonale bedeuten perfekt kalibriert, darunter zu überzeugt.
        </span>
      </figcaption>
    </figure>
  );
}
