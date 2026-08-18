import { num } from "../lib/format";
import styles from "./ScoreHeatmap.module.css";

// Die Verteilung ueber alle Ergebnisse, aus der der Tipp gewaehlt wurde.
//
// Der eigentliche Punkt dieser Darstellung: der abgegebene Tipp ist die Zelle mit dem
// hoechsten Punkte-Erwartungswert, nicht die wahrscheinlichste. Beide sind markiert --
// wo sie auseinanderfallen, sieht man dem Modell bei der Arbeit zu.
export function ScoreHeatmap({
  grid,
  tip,
  argmaxTip,
}: {
  grid: number[][];
  tip: string;
  argmaxTip: string;
}) {
  if (!grid || grid.length === 0) return null;

  const cells = grid.flat();
  const max = Math.max(...cells);
  if (max <= 0) return null;

  // Der Ausschnitt endet bei 5 Toren, die Matrix laeuft bis 10. Bei einem klaren
  // Heimfavoriten liegen dadurch ueber zehn Prozent der Masse ausserhalb -- ohne diese
  // Angabe sieht das aus, als summierten sich die Zellen nicht.
  const covered = cells.reduce((acc, p) => acc + p, 0);

  const [tipHome, tipAway] = tip.split(":").map(Number);
  const [argHome, argAway] = argmaxTip.split(":").map(Number);
  const sameCell = tipHome === argHome && tipAway === argAway;

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
                  const isTip = h === tipHome && a === tipAway;
                  const isArgmax = h === argHome && a === argAway;
                  return (
                    <td
                      key={a}
                      className={`${styles.cell} ${isTip ? styles.tipCell : ""} ${
                        isArgmax && !isTip ? styles.argmaxCell : ""
                      }`}
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
        <span className={styles.keyTip}>Tipp {tip}</span>
        {sameCell ? (
          <span className={styles.keyNote}>zugleich das wahrscheinlichste Ergebnis</span>
        ) : (
          <>
            <span className={styles.keyArgmax}>wahrscheinlichster {argmaxTip}</span>
            <span className={styles.keyNote}>
              Der Tipp maximiert die erwarteten Punkte, nicht die Trefferwahrscheinlichkeit.
            </span>
          </>
        )}
      </p>

      <p className={styles.coverage}>
        Ausschnitt 0–5 Tore je Seite · deckt {num(covered * 100, 1)}% der Verteilung
      </p>
    </div>
  );
}
