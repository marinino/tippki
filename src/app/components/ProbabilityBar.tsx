import { outcomePercentages } from "../lib/format";
import type { ScoresByOutcome } from "../lib/scoreByOutcome";
import styles from "./ProbabilityBar.module.css";

// Eine Komponente fuer beide Tabs. Vorher stand der Balken zweimal im JSX, und die
// beiden Fassungen rundeten unterschiedlich -- im Simulator konnten die Segmente 101%
// ergeben. outcomePercentages() ist jetzt die einzige Rundungsstelle.
//
// Der Balken traegt keine Beschriftung mehr: als 34-px-Band mit schwarzer Schrift auf
// Knallgruen dominierte er die Karte optisch, obwohl er die Nebeninformation ist. Die
// Zahlen stehen jetzt als Zeile darunter, das Band selbst ist 5 px hoch.
//
// Hinter jedem Anteil steht, wenn bekannt, das wahrscheinlichste Ergebnis dieses Ausgangs
// ("Heim 44% · 2:1"). Ohne das zeigte die Karte in drei von vier Spielen ein 1:1 neben einem
// Sieg-Favoriten, und WIE der Favorit gewinnt, stand nirgends. Begruendung und Herkunft der
// Zahlen in src/app/lib/scoreByOutcome.ts.
export function ProbabilityBar({
  homeWinProb,
  drawProb,
  awayWinProb,
  scores,
}: {
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  scores?: ScoresByOutcome;
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
        <span className={styles.item}>
          <span className={styles.label}>
            <i className={`${styles.swatch} ${styles.home}`} aria-hidden="true" />
            Heim {p.home}%
          </span>
          <Score value={scores?.home?.score} />
        </span>
        <span className={styles.item}>
          <span className={styles.label}>
            <i className={`${styles.swatch} ${styles.draw}`} aria-hidden="true" />
            Unent. {p.draw}%
          </span>
          <Score value={scores?.draw?.score} />
        </span>
        <span className={styles.item}>
          <span className={styles.label}>
            <i className={`${styles.swatch} ${styles.away}`} aria-hidden="true" />
            Ausw. {p.away}%
          </span>
          <Score value={scores?.away?.score} />
        </span>
      </div>
    </div>
  );
}

function Score({ value }: { value: string | undefined }) {
  if (!value) return null;
  return (
    <b className={styles.score} title="Wahrscheinlichstes Ergebnis, falls dieser Ausgang eintritt">
      <span className={styles.sep} aria-hidden="true">
        ·{" "}
      </span>
      {value}
    </b>
  );
}
