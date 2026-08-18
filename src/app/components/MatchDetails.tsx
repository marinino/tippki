import type { Prediction } from "../types";
import { num } from "../lib/format";
import { ScoreHeatmap } from "./ScoreHeatmap";
import styles from "./MatchDetails.module.css";

// Quoten, Marktbedingungen und recherchierter Spielkontext lagen vorher als drei
// gleichrangige 11-px-Zeilen unter jeder Karte und machten sie zur Textwand. Jetzt
// stehen sie hinter einer Aufklappzeile -- als <details>, damit Tastatur und
// Screenreader das ohne eigenen Zustand koennen.
export function MatchDetails({ prediction: p }: { prediction: Prediction }) {
  const hasOdds = p.bookmakerOdds != null && p.bookmakerOdds.length > 0;
  const hasConstraints = p.marketConstraints != null && p.marketConstraints.length > 0;
  const hasFactors = p.llmFactors != null && p.llmFactors.length > 0;
  const hasGrid = p.scoreGrid != null && p.scoreGrid.length > 0;
  if (!hasOdds && !hasConstraints && !hasFactors && !hasGrid) return null;

  const summary = [
    hasGrid ? "Ergebnisverteilung" : null,
    hasFactors ? `${p.llmFactors.length} Kontextfaktoren` : null,
    hasConstraints ? "Marktbedingungen" : null,
    hasOdds ? `${p.bookmakerOdds!.length} Quoten` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <details className={styles.details}>
      <summary className={styles.summary}>
        <span className={styles.chevron} aria-hidden="true" />
        {summary}
      </summary>

      <div className={styles.content}>
        {hasGrid && (
          <div className={styles.row}>
            <span className={styles.rowLabel}>Verteilung</span>
            <span className={styles.rowValue}>
              <ScoreHeatmap grid={p.scoreGrid} tip={p.tip} argmaxTip={p.argmaxTip} />
            </span>
          </div>
        )}

        {hasFactors && <ContextFactorList prediction={p} />}

        {hasConstraints && (
          <div className={styles.row}>
            <span className={styles.rowLabel}>Markt im Tipp</span>
            <span className={styles.rowValue}>{p.marketConstraints.join(" · ")}</span>
          </div>
        )}

        {hasOdds && (
          <div className={styles.row}>
            <span className={styles.rowLabel}>Quoten</span>
            <span className={styles.rowValue}>
              {p.bookmakerOdds!.map((b) => (
                <span key={b.bookmaker} className={styles.odds}>
                  <span className={styles.bookmaker}>{b.bookmaker}</span>
                  {num(b.oddsHome, 2)} / {num(b.oddsDraw, 2)} / {num(b.oddsAway, 2)}
                </span>
              ))}
            </span>
          </div>
        )}
      </div>
    </details>
  );
}

// Die Statuszeile ist der wichtige Teil: eine Korrektur, die verworfen oder gedaempft
// wurde, ist eine andere Aussage als eine, die voll durchschlug.
function ContextFactorList({ prediction: p }: { prediction: Prediction }) {
  const status = p.llmBlocked
    ? "Korrektur verworfen — hätte die Tendenz gedreht"
    : p.llmShrinkFactor != null && p.llmShrinkFactor < 1
      ? `Korrektur auf ${Math.round(p.llmShrinkFactor * 100)}% gedämpft (Favoritenschutz)`
      : "Korrektur angewandt";

  const tone = p.llmBlocked ? styles.blocked : p.llmApplied ? styles.applied : "";

  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>Spielkontext</span>
      <span className={styles.rowValue}>
        <ul className={styles.factors}>
          {p.llmFactors.map((factor, i) => (
            <li key={i}>{factor}</li>
          ))}
        </ul>
        <span className={`${styles.status} ${tone}`}>
          {status}
          {p.llmSources.length > 0 && ` · ${p.llmSources.length} Quellen`}
        </span>
      </span>
    </div>
  );
}
