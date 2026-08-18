import type { BacktestResult } from "../types";
import { num, pct } from "../lib/format";
import { CalibrationChart } from "./CalibrationChart";
import { StatCard, StatGrid, StatUnit, StatValue } from "./StatCard";

const BASELINE_LABELS: Record<string, string> = {
  model: "Modell",
  benchmark: "Buchmacher (Schlussquote)",
  baseRate: "H/U/A-Häufigkeit",
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
  const gap =
    backtest && backtest.baselines
      ? backtest.overall.rps - backtest.baselines.benchmark.rps
      : null;

  return (
    <section className="section">
      <div className="section-header">
        <div>
          <h2 className="section-title">Backtest</h2>
          <p className="section-subtitle">
            Modellgüte auf historischen Saisons, gemessen am Buchmacher
          </p>
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
                  Gesamt über {backtest.perSeason.length} Saisons ({backtest.totalEvaluated}{" "}
                  Spiele) · Messlatte {backtest.benchmarkLabel}
                </>
              }
            >
              <StatValue>
                {num(backtest.overall.rps, 4)} <StatUnit>RPS</StatUnit>
              </StatValue>
              <StatValue small style={{ color: "var(--text-secondary)", marginTop: 4 }}>
                LogLoss {num(backtest.overall.logLoss, 4)} · Brier{" "}
                {num(backtest.overall.brier, 4)} · {pct(backtest.overall.tendencyAccuracy)} Tendenz
              </StatValue>
              {gap != null && (
                <p className="section-subtitle" style={{ marginTop: 6 }}>
                  {gap > 0
                    ? `${num(gap, 4)} RPS hinter dem Buchmacher. Das ist die Zahl, um die es geht — der absolute RPS sagt für sich genommen nichts.`
                    : `${num(-gap, 4)} RPS vor dem Buchmacher.`}
                </p>
              )}
            </StatCard>

            {backtest.perSeason.map((s) => (
              <StatCard key={s.season} label={`Saison ${s.season}`}>
                <StatValue small>
                  {num(s.rps, 4)} <StatUnit>RPS</StatUnit>
                </StatValue>
                <p className="section-subtitle">
                  {pct(s.tendencyAccuracy)} Tendenz · {s.evaluated} Spiele
                </p>
              </StatCard>
            ))}
          </StatGrid>

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
                    <p className="section-subtitle">
                      {pct(b.tendencyAccuracy)} Tendenz
                      {b.scoreN > 0 ? ` · Score ${num(b.scoreLogLoss, 3)}` : ""}
                    </p>
                  </StatCard>
                ))}
              </StatGrid>
            </>
          )}

          <p className="section-subtitle" style={{ marginTop: 24 }}>
            Kalibrierung — Modell
          </p>
          <CalibrationChart calibration={backtest.calibration} />

          <p className="section-subtitle" style={{ marginTop: 24 }}>
            Kalibrierung — Buchmacher, dieselben Spiele
          </p>
          <CalibrationChart calibration={backtest.benchmarkCalibration} />
        </>
      )}
    </section>
  );
}
