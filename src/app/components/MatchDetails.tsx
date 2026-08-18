import type { Prediction } from "../types";
import { ScoreHeatmap } from "./ScoreHeatmap";
import { PriceSheetView } from "./PriceSheetView";
import styles from "./MatchDetails.module.css";

// Preisblatt, Ergebnisverteilung und recherchierter Spielkontext stehen hinter einer
// Aufklappzeile -- als <details>, damit Tastatur und Screenreader das ohne eigenen
// Zustand koennen. Vorn auf der Karte bleibt eine Zahl, hier liegt die ganze Verteilung.
export function MatchDetails({ prediction: p }: { prediction: Prediction }) {
  const hasFactors = p.llmFactors != null && p.llmFactors.length > 0;
  const hasGrid = p.scoreGrid != null && p.scoreGrid.length > 0;

  const summary = [
    "Alle Märkte",
    hasGrid ? "Ergebnisverteilung" : null,
    hasFactors ? `${p.llmFactors.length} Kontextfaktoren` : null,
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
        <PriceSheetView prices={p.prices} />

        {hasGrid && (
          <div className={styles.row}>
            <span className={styles.rowLabel}>Verteilung</span>
            <span className={styles.rowValue}>
              <ScoreHeatmap grid={p.scoreGrid} mostLikelyScore={p.mostLikelyScore} />
            </span>
          </div>
        )}

        {hasFactors && <ContextFactorList prediction={p} />}
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
