import type { Prediction } from "../types";
import { formatTimestamp } from "../lib/format";
import { ScoreHeatmap } from "./ScoreHeatmap";
import { PriceSheetView } from "./PriceSheetView";
import styles from "./MatchDetails.module.css";

// Preisblatt, Ergebnisverteilung und recherchierter Spielkontext stehen hinter einer
// Aufklappzeile -- als <details>, damit Tastatur und Screenreader das ohne eigenen
// Zustand koennen. Vorn auf der Karte bleibt eine Zahl, hier liegt die ganze Verteilung.
export function MatchDetails({ prediction: p }: { prediction: Prediction }) {
  const hasFactors = p.llmFactors != null && p.llmFactors.length > 0;
  const hasGrid = p.scoreGrid != null && p.scoreGrid.length > 0;
  // Auch ein ergebnisloser oder gescheiterter Recherchelauf gehoert hierher. Vorher fiel
  // beides stillschweigend weg und war von "nie gefragt" nicht zu unterscheiden -- genau
  // die Verwechslung, die eine automatisch laufende Recherche unbemerkt ausfallen laesst.
  const hasContext = p.llmStatus !== "nicht_recherchiert";

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

        {hasContext && <ContextFactorList prediction={p} />}
      </div>
    </details>
  );
}

// Die Statuszeile ist der wichtige Teil: sie sagt, wie GROSS die Korrektur ausgefallen ist.
// Seit dem Ausbau der Favoritensicherung wird nichts mehr gedaempft oder verworfen -- die
// Klammerung bei +/-16 Prozent ist die einzige Grenze, und ob der Layer ueberhaupt etwas
// bewegt, sieht man nur hier.
function ContextFactorList({ prediction: p }: { prediction: Prediction }) {
  const signed = (pct: number) => `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(0)} %`;

  // Der Fehlschlag zuerst: er ist der einzige Zustand, der eine Handlung verlangt.
  const status =
    p.llmStatus === "fehlgeschlagen"
      ? `Recherche fehlgeschlagen${p.llmFailureReason ? ` — ${p.llmFailureReason}` : ""}`
      : p.llmHomeAdjustmentPct == null || p.llmAwayAdjustmentPct == null
        ? "Recherchiert, keine Korrektur"
        : `Torerwartung Heim ${signed(p.llmHomeAdjustmentPct)}, Auswärts ${signed(p.llmAwayAdjustmentPct)}`;

  const tone = p.llmApplied ? styles.applied : "";

  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>Spielkontext</span>
      <span className={styles.rowValue}>
        {p.llmFactors.length > 0 && (
          <ul className={styles.factors}>
            {p.llmFactors.map((factor, i) => (
              <li key={i}>{factor}</li>
            ))}
          </ul>
        )}
        <span className={`${styles.status} ${tone}`}>
          {status}
          {p.llmSources.length > 0 && ` · ${p.llmSources.length} Quellen`}
          {p.llmFetchedAt && ` · ${formatTimestamp(p.llmFetchedAt)}`}
        </span>
      </span>
    </div>
  );
}
