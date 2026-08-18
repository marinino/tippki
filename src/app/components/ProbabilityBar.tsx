import { outcomePercentages } from "../lib/format";
import styles from "./ProbabilityBar.module.css";

// Eine Komponente fuer beide Tabs. Vorher stand der Balken zweimal im JSX, und die
// beiden Fassungen rundeten unterschiedlich -- im Simulator konnten die Segmente 101%
// ergeben. outcomePercentages() ist jetzt die einzige Rundungsstelle.
//
// Der Balken traegt keine Beschriftung mehr: als 34-px-Band mit schwarzer Schrift auf
// Knallgruen dominierte er die Karte optisch, obwohl er die Nebeninformation ist. Die
// Zahlen stehen jetzt als Zeile darunter, das Band selbst ist 5 px hoch.
export function ProbabilityBar({
  homeWinProb,
  drawProb,
  awayWinProb,
}: {
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
}) {
  const p = outcomePercentages(homeWinProb, drawProb, awayWinProb);

  return (
    <div className={styles.wrap}>
      <div
        className={styles.bar}
        role="img"
        aria-label={`Heimsieg ${p.home} Prozent, Unentschieden ${p.draw} Prozent, Auswärtssieg ${p.away} Prozent`}
      >
        <div className={`${styles.segment} ${styles.home}`} style={{ width: `${p.home}%` }} />
        <div className={`${styles.segment} ${styles.draw}`} style={{ width: `${p.draw}%` }} />
        <div className={`${styles.segment} ${styles.away}`} style={{ width: `${p.away}%` }} />
      </div>
      <div className={styles.legend}>
        <span>
          <i className={`${styles.swatch} ${styles.home}`} aria-hidden="true" />
          Heim {p.home}%
        </span>
        <span>
          <i className={`${styles.swatch} ${styles.draw}`} aria-hidden="true" />
          Unent. {p.draw}%
        </span>
        <span>
          <i className={`${styles.swatch} ${styles.away}`} aria-hidden="true" />
          Ausw. {p.away}%
        </span>
      </div>
    </div>
  );
}
