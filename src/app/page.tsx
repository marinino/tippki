"use client";

import { useEffect, useState } from "react";

interface Prediction {
  homeTeam: string;
  awayTeam: string;
  expectedHomeGoals: number;
  expectedAwayGoals: number;
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  mostLikelyScore: string;
  homeIsEstimated: boolean;
  awayIsEstimated: boolean;
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
  return `${(x * 100).toFixed(1)}%`;
}

export default function Home() {
  const [predictions, setPredictions] = useState<Prediction[] | null>(null);
  const [backtest, setBacktest] = useState<BacktestResult | null>(null);
  const [backtestLoading, setBacktestLoading] = useState(false);

  useEffect(() => {
    fetch("/api/predictions")
      .then((res) => res.json())
      .then((data) => setPredictions(data.predictions));
  }, []);

  async function runBacktest() {
    setBacktestLoading(true);
    const res = await fetch("/api/backtest");
    const data = await res.json();
    setBacktest(data);
    setBacktestLoading(false);
  }

  return (
    <main>
      <h1>Tippki</h1>

      <section>
        <h2>Spieltag-Tipps</h2>
        {!predictions && <p>Lade...</p>}
        {predictions && (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={cellStyle}>Spiel</th>
                <th style={cellStyle}>Tipp</th>
                <th style={cellStyle}>Sieg H</th>
                <th style={cellStyle}>Unentschieden</th>
                <th style={cellStyle}>Sieg A</th>
              </tr>
            </thead>
            <tbody>
              {predictions.map((p) => (
                <tr key={`${p.homeTeam}-${p.awayTeam}`}>
                  <td style={cellStyle}>
                    {p.homeTeam}
                    {p.homeIsEstimated ? " *" : ""} vs {p.awayTeam}
                    {p.awayIsEstimated ? " *" : ""}
                  </td>
                  <td style={cellStyle}>{p.mostLikelyScore}</td>
                  <td style={cellStyle}>{pct(p.homeWinProb)}</td>
                  <td style={cellStyle}>{pct(p.drawProb)}</td>
                  <td style={cellStyle}>{pct(p.awayWinProb)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p style={{ fontSize: "0.8rem", color: "#666" }}>* geschätzt (keine/wenig Bundesliga-Historie)</p>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>Backtest (letzte 3 Saisons)</h2>
        <button onClick={runBacktest} disabled={backtestLoading}>
          {backtestLoading ? "Läuft..." : "Backtest starten"}
        </button>
        {backtest && (
          <>
            <ul>
              {backtest.perSeason.map((s) => (
                <li key={s.season}>
                  Saison {s.season} ({s.trainMatchCount} Trainingsspiele, {s.evaluated} Testspiele):
                  Tendenz {pct(s.tendencyAccuracy)}, Exakt {pct(s.exactScoreAccuracy)}
                </li>
              ))}
            </ul>
            <p>
              <strong>
                Gesamt über {backtest.perSeason.length} Saisons ({backtest.totalEvaluated} Spiele):
                Tendenz {pct(backtest.totalTendencyAccuracy)}, Exakt{" "}
                {pct(backtest.totalExactScoreAccuracy)}
              </strong>
            </p>
          </>
        )}
      </section>
    </main>
  );
}

const cellStyle: React.CSSProperties = {
  border: "1px solid #ddd",
  padding: "0.4rem 0.6rem",
  textAlign: "left",
};
