import { num } from "../lib/format";
import styles from "./ScoreHeatmap.module.css";

// Die volle Verteilung ueber alle Ergebnisse -- die Groesse, aus der jede Quote des
// Preisblatts abgeleitet ist.
//
// Sie steht hier, weil sie die Schwaeche eines jeden Torzahlmodells sichtbar macht: die
// wahrscheinlichste Einzelzelle traegt selten mehr als zwoelf Prozent. Wer nur eine Zahl
// sieht, haelt sie fuer eine Prognose; wer die Flaeche sieht, weiss, wie flach sie ist.
export function ScoreHeatmap({
  grid,
  mostLikelyScore,
}: {
  grid: number[][];
  mostLikelyScore: string;
}) {
  if (!grid || grid.length === 0) return null;

  const cells = grid.flat();
  const max = Math.max(...cells);
  if (max <= 0) return null;

  // Der Ausschnitt endet bei 5 Toren, die Matrix laeuft bis 10. Bei einem klaren
  // Heimfavoriten liegen dadurch ueber zehn Prozent der Masse ausserhalb -- ohne diese
  // Angabe sieht das aus, als summierten sich die Zellen nicht.
  const covered = cells.reduce((acc, p) => acc + p, 0);

  const [bestHome, bestAway] = mostLikelyScore.split(":").map(Number);

  return (
    <div className={styles.wrap}>
      <div className={styles.chart}>
        <span className={`${styles.axis} ${styles.axisAway}`}>Auswärtstore →</span>
        <span className={`${styles.axis} ${styles.axisHome}`}>Heimtore →</span>

        <table className={styles.grid}>
          <thead>
            <tr>
              <td />
              {grid[0].map((_, a) => (
                <th key={a} scope="col" className={styles.head}>
                  {a}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row, h) => (
              <tr key={h}>
                <th scope="row" className={styles.head}>
                  {h}
                </th>
                {row.map((p, a) => {
                  const isBest = h === bestHome && a === bestAway;
                  return (
                    <td
                      key={a}
                      className={`${styles.cell} ${isBest ? styles.tipCell : ""}`}
                      // Deckkraft proportional zur Wahrscheinlichkeit, Wurzel als
                      // Kompression: linear verschwinden alle Zellen ausser 1:1 und 2:1.
                      style={{ "--fill": Math.sqrt(p / max) } as React.CSSProperties}
                      title={`${h}:${a} — ${num(p * 100, 1)}%`}
                    >
                      <span className={styles.value}>{(p * 100).toFixed(0)}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className={styles.legend}>
        <span className={styles.keyTip}>Häufigstes {mostLikelyScore}</span>
        <span className={styles.keyNote}>
          mit {num(max * 100, 1)}% — jedes einzelne Ergebnis bleibt unwahrscheinlich.
        </span>
      </p>

      <p className={styles.coverage}>
        Ausschnitt 0–5 Tore je Seite · deckt {num(covered * 100, 1)}% der Verteilung
      </p>
    </div>
  );
}
