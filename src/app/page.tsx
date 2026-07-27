"use client";

import { useEffect, useState } from "react";

interface Prediction {
  homeTeam: string;
  awayTeam: string;
  homeLogo: string | null;
  awayLogo: string | null;
  date: string;
  expectedHomeGoals: number;
  expectedAwayGoals: number;
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  mostLikelyScore: string;
  homeIsEstimated: boolean;
  awayIsEstimated: boolean;
}

interface PredictionsResponse {
  predictions: Prediction[];
  matchday: number | null;
  nextMatchday: number | null;
  availableMatchdays: number[];
}

interface SeasonBacktest {
  season: string;
  trainMatchCount: number;
  evaluated: number;
  tendencyAccuracy: number;
  exactScoreAccuracy: number;
}

interface BacktestResult {
  perSeason: SeasonBacktest[];
  totalEvaluated: number;
  totalTendencyAccuracy: number;
  totalExactScoreAccuracy: number;
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function formatMatchDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" }) +
    ", " +
    date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

export default function Home() {
  const [data, setData] = useState<PredictionsResponse | null>(null);
  const [predictionsLoading, setPredictionsLoading] = useState(true);
  const [backtest, setBacktest] = useState<BacktestResult | null>(null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [refreshLoading, setRefreshLoading] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);

  useEffect(() => {
    loadMatchday();
  }, []);

  async function loadMatchday(matchday?: number) {
    setPredictionsLoading(true);
    const url = matchday ? `/api/predictions?matchday=${matchday}` : "/api/predictions";
    const res = await fetch(url);
    const result = await res.json();
    setData(result);
    setPredictionsLoading(false);
  }

  async function refreshData() {
    setRefreshLoading(true);
    setRefreshMessage(null);
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? "Fehler beim Aktualisieren");
      setRefreshMessage(`${result.resultsCount} Ergebnisse, ${result.xgCount} xG-Spiele aktualisiert`);
      await loadMatchday(data?.matchday ?? undefined);
    } catch (err) {
      setRefreshMessage(err instanceof Error ? err.message : "Fehler beim Aktualisieren");
    } finally {
      setRefreshLoading(false);
    }
  }

  async function runBacktest() {
    setBacktestLoading(true);
    const res = await fetch("/api/backtest");
    const result = await res.json();
    setBacktest(result);
    setBacktestLoading(false);
  }

  return (
    <main className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Bundesliga</p>
          <h1 className="title">Tippki</h1>
        </div>
        <div className="refresh-block">
          <button className="button secondary" onClick={refreshData} disabled={refreshLoading}>
            {refreshLoading ? "Aktualisiert …" : "Ergebnisse aktualisieren"}
          </button>
          {refreshMessage && <p className="refresh-message">{refreshMessage}</p>}
        </div>
      </div>

      <section className="section">
        <div className="section-header">
          <div>
            <h2 className="section-title">Spieltag-Tipps</h2>
            {data?.nextMatchday != null && data.matchday === data.nextMatchday && (
              <p className="section-subtitle">Nächster Spieltag</p>
            )}
          </div>
          {data && data.availableMatchdays.length > 0 && (
            <select
              className="select"
              value={data.matchday ?? ""}
              onChange={(e) => loadMatchday(Number(e.target.value))}
            >
              {data.availableMatchdays.map((md) => (
                <option key={md} value={md}>
                  Spieltag {md}
                  {md === data.nextMatchday ? " · nächster" : ""}
                </option>
              ))}
            </select>
          )}
        </div>

        {!data && <p className="loading-text">Lade Vorhersagen …</p>}

        {data && (
          <div className="card-list" style={{ opacity: predictionsLoading ? 0.5 : 1 }}>
            {data.predictions.map((p) => (
              <MatchCard key={`${p.homeTeam}-${p.awayTeam}`} prediction={p} />
            ))}
          </div>
        )}

        <p className="footnote">* geschätzt (keine oder wenig Bundesliga-Historie)</p>
      </section>

      <section className="section">
        <div className="section-header">
          <div>
            <h2 className="section-title">Backtest</h2>
            <p className="section-subtitle">Modellgüte auf historischen Saisons</p>
          </div>
          <button className="button" onClick={runBacktest} disabled={backtestLoading}>
            {backtestLoading ? "Läuft …" : backtest ? "Neu berechnen" : "Starten"}
          </button>
        </div>

        {backtest && (
          <div className="stat-grid">
            <div className="stat-card wide">
              <p className="stat-label">
                Gesamt über {backtest.perSeason.length} Saisons ({backtest.totalEvaluated} Spiele)
              </p>
              <p className="stat-value">
                {pct(backtest.totalTendencyAccuracy)}{" "}
                <span className="stat-value small" style={{ color: "var(--text-tertiary)" }}>
                  Tendenz
                </span>
              </p>
              <p className="stat-value small" style={{ color: "var(--text-secondary)", marginTop: 4 }}>
                {pct(backtest.totalExactScoreAccuracy)} exakte Ergebnisse
              </p>
            </div>
            {backtest.perSeason.map((s) => (
              <div className="stat-card" key={s.season}>
                <p className="stat-label">Saison {s.season}</p>
                <p className="stat-value small">
                  {pct(s.tendencyAccuracy)} <span style={{ color: "var(--text-tertiary)" }}>Tendenz</span>
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function MatchCard({ prediction: p }: { prediction: Prediction }) {
  const homePct = Math.round(p.homeWinProb * 100);
  const drawPct = Math.round(p.drawProb * 100);
  const awayPct = 100 - homePct - drawPct;

  return (
    <div className="match-card">
      <div className="match-main">
        <div className="match-teams">
          <span className="match-team home">
            {p.homeLogo && (
              <span className="team-logo-badge">
                <img src={p.homeLogo} alt="" className="team-logo" />
              </span>
            )}
            <span>
              {p.homeTeam}
              {p.homeIsEstimated && <span className="estimated-mark"> *</span>}
            </span>
          </span>
          <span className="match-vs">vs</span>
          <span className="match-team away">
            <span>
              {p.awayIsEstimated && <span className="estimated-mark">* </span>}
              {p.awayTeam}
            </span>
            {p.awayLogo && (
              <span className="team-logo-badge">
                <img src={p.awayLogo} alt="" className="team-logo" />
              </span>
            )}
          </span>
        </div>

        <div className="prob-bar">
          <div className="prob-bar-segment home" style={{ width: `${homePct}%` }}>
            <span className="letter">H</span>
            {homePct}%
          </div>
          <div className="prob-bar-segment draw" style={{ width: `${drawPct}%` }}>
            <span className="letter">U</span>
            {drawPct}%
          </div>
          <div className="prob-bar-segment away" style={{ width: `${awayPct}%` }}>
            <span className="letter">A</span>
            {awayPct}%
          </div>
        </div>
      </div>

      <div className="match-side">
        <span className="match-date">{formatMatchDate(p.date)}</span>
        <span className="tip-badge">{p.mostLikelyScore}</span>
        <span className="expected-score">
          Ø {p.expectedHomeGoals.toFixed(1)}:{p.expectedAwayGoals.toFixed(1)}
        </span>
      </div>
    </div>
  );
}
