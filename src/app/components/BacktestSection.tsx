import type { BacktestResult } from "../types";
import { num, pct } from "../lib/format";
import { CalibrationChart } from "./CalibrationChart";
import { StatCard, StatGrid, StatUnit, StatValue } from "./StatCard";

const BASELINE_LABELS: Record<string, string> = {
  modelOnly: "Nur Modell",
  blended: "Modell + Markt (50/50)",
  pureMarket: "Nur Buchmacher",
  baseRate: "Nur H/U/A-Häufigkeit",
};

export function BacktestSection({
  backtest,
  loading,
  onRun,
}: {
  backtest: BacktestResult | null;
  loading: boolean;
  onRun: () => void;
}) {
  return (
    <section className="section">
      <div className="section-header">
        <div>
          <h2 className="section-title">Backtest</h2>
          <p className="section-subtitle">Modellgüte auf historischen Saisons</p>
        </div>
        <button className="button" onClick={onRun} disabled={loading}>
          {loading ? "Läuft …" : backtest ? "Neu berechnen" : "Starten"}
        </button>
      </div>

      {backtest && (
        <>
          <StatGrid>
            <StatCard
              wide
              label={
                <>
                  Gesamt über {backtest.perSeason.length} Saisons ({backtest.totalEvaluated} Spiele) ·
                  Schema {backtest.schemeLabel}
                </>
              }
            >
              <StatValue>
                {num(backtest.overall.pointsPerMatch, 3)} <StatUnit>Punkte / Spiel</StatUnit>
              </StatValue>
              <StatValue small style={{ color: "var(--text-secondary)", marginTop: 4 }}>
                {pct(backtest.totalTendencyAccuracy)} Tendenz ·{" "}
                {pct(backtest.totalExactScoreAccuracy)} exakt · RPS{" "}
                {num(backtest.overall.rps, 4)}
              </StatValue>
              {backtest.overall.expectedPointsPerMatch != null && (
                <p className="section-subtitle" style={{ marginTop: 6 }}>
                  Modell erwartet {num(backtest.overall.expectedPointsPerMatch, 3)} Punkte/Spiel
                  und holt {num(backtest.overall.pointsPerMatch, 3)} — die Differenz ist der
                  Kalibrierungsfehler.
                </p>
              )}
            </StatCard>

            {backtest.perSeason.map((s) => (
              <StatCard key={s.season} label={`Saison ${s.season}`}>
                <StatValue small>
                  {num(s.pointsPerMatch, 2)} <StatUnit>Pkt</StatUnit>
                </StatValue>
                <p className="section-subtitle">
                  {pct(s.tendencyAccuracy)} Tendenz · RPS {num(s.rps, 3)}
                </p>
              </StatCard>
            ))}
          </StatGrid>

          <p className="section-subtitle" style={{ marginTop: 24 }}>
            Kalibrierung
          </p>
          <CalibrationChart calibration={backtest.calibration} />

          {backtest.baselines && (
            <>
              <p className="section-subtitle" style={{ marginTop: 20 }}>
                Vergleichsmaßstäbe (RPS: kleiner ist besser). Die Tendenz-Trefferquoten liegen alle
                innerhalb ihres Standardfehlers von ±1,0 Prozentpunkten und sind deshalb nicht
                unterscheidbar — der RPS trennt sie dagegen klar.
              </p>
              <StatGrid>
                {Object.entries(backtest.baselines).map(([name, b]) => (
                  <StatCard key={name} label={BASELINE_LABELS[name] ?? name}>
                    <StatValue small>
                      {num(b.rps, 4)} <StatUnit>RPS</StatUnit>
                    </StatValue>
                    <p className="section-subtitle">{pct(b.tendencyAccuracy)} Tendenz</p>
                  </StatCard>
                ))}
              </StatGrid>
            </>
          )}
        </>
      )}
    </section>
  );
}
