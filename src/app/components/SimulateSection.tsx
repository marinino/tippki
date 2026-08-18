import { useState } from "react";
import type { useSimulation } from "../hooks/useSimulation";
import { fixtureKey } from "../hooks/useSimulation";
import { LeagueTable } from "./LeagueTable";
import { SimulatorMatchRow } from "./SimulatorMatchRow";
import { SkeletonCards } from "./Skeleton";
import styles from "./SimulateSection.module.css";

export function SimulateSection({ sim }: { sim: ReturnType<typeof useSimulation> }) {
  const { data, loading, inputs, hits, matchday, error, updateInput, submit, reset } = sim;
  const [confirmingReset, setConfirmingReset] = useState(false);

  return (
    <section className="section">
      <div className="section-header">
        <div>
          <h2 className="section-title">Saison 26/27 simulieren</h2>
          <p className="section-subtitle">
            Modell + Form (Tordifferenz statt echtem xG, weil es für erfundene Spiele keine
            gibt) ·{" "}
            {data && data.predictions.length === 0
              ? "Saison beendet"
              : `Spieltag ${matchday}${data ? ` von ${data.totalMatchdays}` : ""}`}
          </p>
        </div>
        <div className={styles.controls}>
          {hits.total > 0 && (
            <span className="section-subtitle">
              Tendenz bisher: {hits.correct}/{hits.total} (
              {Math.round((hits.correct / hits.total) * 100)}%)
            </span>
          )}
          {confirmingReset ? (
            <>
              <span className="section-subtitle">Wirklich zurücksetzen?</span>
              <button
                className="button secondary"
                onClick={() => {
                  reset();
                  setConfirmingReset(false);
                }}
              >
                Ja, löschen
              </button>
              <button className="button secondary" onClick={() => setConfirmingReset(false)}>
                Abbrechen
              </button>
            </>
          ) : (
            <button className="button secondary" onClick={() => setConfirmingReset(true)}>
              Zurücksetzen
            </button>
          )}
        </div>
      </div>

      {loading && !data && <SkeletonCards />}

      {data && data.predictions.length > 0 && (
        <div className="card-list" style={{ opacity: loading ? 0.45 : 1 }}>
          {data.predictions.map((p) => (
            <SimulatorMatchRow
              key={fixtureKey(p.homeTeam, p.awayTeam)}
              prediction={p}
              input={inputs[fixtureKey(p.homeTeam, p.awayTeam)] ?? { home: "", away: "" }}
              onChange={(side, value) => updateInput(p.homeTeam, p.awayTeam, side, value)}
            />
          ))}
        </div>
      )}

      {error && <p className={styles.error}>{error}</p>}

      {data && data.predictions.length > 0 && (
        <button className="button" onClick={submit} disabled={loading} style={{ marginTop: 12 }}>
          Ergebnisse übernehmen &amp; weiter
        </button>
      )}

      {data && data.predictions.length === 0 && (
        <p className="loading-text">Saison komplett simuliert.</p>
      )}

      {data && data.table.length > 0 && (
        <div className={styles.tableBlock}>
          <h3 className={styles.tableTitle}>Tabelle nach Spieltag {matchday - 1}</h3>
          <LeagueTable rows={data.table} dimmed={loading} />
        </div>
      )}
    </section>
  );
}
