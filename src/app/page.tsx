"use client";

import { useEffect, useState } from "react";
import { DEFAULT_SCHEME_KEY, SCORING_SCHEMES } from "../eval/scoringScheme";

interface BookmakerOdds {
  bookmaker: string;
  oddsHome: number;
  oddsDraw: number;
  oddsAway: number;
}

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
  // Der abzugebende Tipp: maximiert den Punkte-Erwartungswert, nicht die
  // Einzelwahrscheinlichkeit. Weicht deshalb bewusst oft vom wahrscheinlichsten
  // Ergebnis (argmaxTip) ab.
  tip: string;
  expectedPoints: number;
  runnerUpTip: string;
  runnerUpExpectedPoints: number;
  argmaxTip: string;
  mostLikelyScore: string;
  homeIsEstimated: boolean;
  awayIsEstimated: boolean;
  oddsBlended: boolean;
  // Welche Marktinformationen in die Ergebnismatrix eingeflossen sind, z.B.
  // ["1X2", "Totals (10 Linien)", "Spread (4 Linien)"].
  marketConstraints: string[];
  bookmakerOdds: BookmakerOdds[] | null;
  // Recherchierter Spielkontext (Ausfälle, Belastung, Motivation).
  llmApplied: boolean;
  llmBlocked: boolean;
  llmShrinkFactor: number | null;
  llmFactors: string[];
  llmSummary: string | null;
  llmSources: string[];
}

interface PredictionsResponse {
  predictions: Prediction[];
  matchday: number | null;
  nextMatchday: number | null;
  availableMatchdays: number[];
  scheme: string;
  schemeLabel: string;
  oddsFetchedAt: string | null;
  llmFetchedAt: string | null;
  llmModel: string | null;
}

interface SeasonBacktest {
  season: string;
  trainMatchCount: number;
  evaluated: number;
  tendencyAccuracy: number;
  exactScoreAccuracy: number;
  pointsPerMatch: number;
  rps: number;
}

interface BacktestResult {
  perSeason: SeasonBacktest[];
  totalEvaluated: number;
  totalTendencyAccuracy: number;
  totalExactScoreAccuracy: number;
  schemeLabel: string;
  overall: {
    pointsPerMatch: number;
    expectedPointsPerMatch: number | null;
    rps: number;
    logLoss: number;
  };
  baselines: Record<string, { tendencyAccuracy: number; rps: number }>;
}

interface TableEntry {
  position: number;
  team: string;
  logo: string | null;
  matches: number;
  won: number;
  draw: number;
  lost: number;
  goals: number;
  opponentGoals: number;
  goalDiff: number;
  points: number;
}

interface TableResponse {
  season: string;
  table: TableEntry[];
}

interface SimPrediction {
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
  tip: string;
  expectedPoints: number;
  runnerUpTip: string;
  runnerUpExpectedPoints: number;
  argmaxTip: string;
  mostLikelyScore: string;
  homeIsEstimated: boolean;
  awayIsEstimated: boolean;
}

interface SimResponse {
  matchday: number;
  totalMatchdays: number;
  predictions: SimPrediction[];
  table: TableEntry[];
}

interface SimResult {
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
}

const SIM_STORAGE_KEY = "tippki-simulation";

const BASELINE_LABELS: Record<string, string> = {
  modelOnly: "Nur Modell",
  blended: "Modell + Markt (50/50)",
  pureMarket: "Nur Buchmacher",
  baseRate: "Nur H/U/A-Häufigkeit",
};

type Tab = "predictions" | "table" | "backtest" | "simulate";

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
  const [oddsRefreshLoading, setOddsRefreshLoading] = useState(false);
  const [oddsRefreshMessage, setOddsRefreshMessage] = useState<string | null>(null);
  const [llmRefreshLoading, setLlmRefreshLoading] = useState(false);
  const [llmRefreshMessage, setLlmRefreshMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("predictions");
  const [table, setTable] = useState<TableResponse | null>(null);
  const [tableLoading, setTableLoading] = useState(false);
  const [scheme, setScheme] = useState<string>(DEFAULT_SCHEME_KEY);

  const [simResultsSoFar, setSimResultsSoFar] = useState<SimResult[]>([]);
  const [simMatchday, setSimMatchday] = useState(1);
  const [simData, setSimData] = useState<SimResponse | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simInputs, setSimInputs] = useState<Record<string, { home: string; away: string }>>({});
  const [simHits, setSimHits] = useState({ correct: 0, total: 0 });
  const [simRestored, setSimRestored] = useState(false);

  useEffect(() => {
    loadMatchday();
  }, []);

  useEffect(() => {
    if (tab === "table" && !table) {
      loadTable();
    }
  }, [tab]);

  useEffect(() => {
    const raw = localStorage.getItem(SIM_STORAGE_KEY);
    if (raw) {
      try {
        const saved = JSON.parse(raw);
        setSimResultsSoFar(saved.resultsSoFar ?? []);
        setSimMatchday(saved.matchday ?? 1);
        setSimHits(saved.hits ?? { correct: 0, total: 0 });
      } catch {
        // ignorieren, mit leerer Simulation starten
      }
    }
    setSimRestored(true);
  }, []);

  useEffect(() => {
    if (!simRestored) return;
    localStorage.setItem(
      SIM_STORAGE_KEY,
      JSON.stringify({ resultsSoFar: simResultsSoFar, matchday: simMatchday, hits: simHits })
    );
  }, [simResultsSoFar, simMatchday, simHits, simRestored]);

  useEffect(() => {
    if (tab === "simulate" && simRestored && !simData) {
      loadSimMatchday(simMatchday, simResultsSoFar);
    }
  }, [tab, simRestored]);

  async function loadTable() {
    setTableLoading(true);
    const res = await fetch("/api/table");
    const result = await res.json();
    setTable(result);
    setTableLoading(false);
  }

  async function loadMatchday(matchday?: number, schemeKey = scheme) {
    setPredictionsLoading(true);
    const params = new URLSearchParams({ scheme: schemeKey });
    if (matchday) params.set("matchday", String(matchday));
    const res = await fetch(`/api/predictions?${params}`);
    const result = await res.json();
    setData(result);
    setPredictionsLoading(false);
  }

  // Das Punkteschema bestimmt den optimalen Tipp, nicht nur seine Bewertung -- ein
  // Wechsel muss deshalb neu rechnen lassen, nicht nur die Anzeige umrechnen.
  function changeScheme(schemeKey: string) {
    setScheme(schemeKey);
    loadMatchday(data?.matchday ?? undefined, schemeKey);
    if (tab === "simulate") loadSimMatchday(simMatchday, simResultsSoFar, schemeKey);
    if (backtest) runBacktest(schemeKey);
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
      if (tab === "table") await loadTable();
    } catch (err) {
      setRefreshMessage(err instanceof Error ? err.message : "Fehler beim Aktualisieren");
    } finally {
      setRefreshLoading(false);
    }
  }

  async function refreshOdds() {
    setOddsRefreshLoading(true);
    setOddsRefreshMessage(null);
    try {
      const res = await fetch("/api/refresh-odds", { method: "POST" });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? "Fehler beim Aktualisieren der Quoten");
      setOddsRefreshMessage(`Spieltag ${result.matchday}: ${result.fixturesWithOdds}/${result.fixturesTotal} Quoten geholt`);
      await loadMatchday(data?.matchday ?? undefined);
    } catch (err) {
      setOddsRefreshMessage(err instanceof Error ? err.message : "Fehler beim Aktualisieren der Quoten");
    } finally {
      setOddsRefreshLoading(false);
    }
  }

  // Kostet echtes Geld (rund 1 $ für neun Partien), deshalb nur auf Knopfdruck.
  async function refreshLlm() {
    setLlmRefreshLoading(true);
    setLlmRefreshMessage(null);
    try {
      const res = await fetch("/api/refresh-llm", { method: "POST" });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? "Fehler beim Recherchieren");
      const failed = Object.keys(result.failures ?? {}).length;
      setLlmRefreshMessage(
        `Spieltag ${result.matchday}: ${result.fixturesWithContext}/${result.fixturesTotal} recherchiert, ` +
          `${result.fixturesWithFactors} mit Faktoren` +
          (failed > 0 ? `, ${failed} fehlgeschlagen` : "") +
          ` · ${result.estimatedCostUsd.toFixed(2)} USD`
      );
      await loadMatchday(data?.matchday ?? undefined);
    } catch (err) {
      setLlmRefreshMessage(err instanceof Error ? err.message : "Fehler beim Recherchieren");
    } finally {
      setLlmRefreshLoading(false);
    }
  }

  async function loadSimMatchday(matchday: number, resultsSoFar: SimResult[], schemeKey = scheme) {
    setSimLoading(true);
    const res = await fetch("/api/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matchday, resultsSoFar, scheme: schemeKey }),
    });
    const result: SimResponse = await res.json();
    setSimData(result);
    const prefill: Record<string, { home: string; away: string }> = {};
    for (const p of result.predictions) {
      const [home, away] = p.tip.split(":");
      prefill[`${p.homeTeam}|${p.awayTeam}`] = { home, away };
    }
    setSimInputs(prefill);
    setSimLoading(false);
  }

  function updateSimInput(homeTeam: string, awayTeam: string, side: "home" | "away", value: string) {
    setSimInputs((prev) => ({
      ...prev,
      [`${homeTeam}|${awayTeam}`]: { ...prev[`${homeTeam}|${awayTeam}`], [side]: value },
    }));
  }

  async function submitSimMatchday() {
    if (!simData) return;
    const newResults: SimResult[] = [];
    let correct = 0;

    for (const p of simData.predictions) {
      const key = `${p.homeTeam}|${p.awayTeam}`;
      const input = simInputs[key];
      const homeGoals = Number(input?.home);
      const awayGoals = Number(input?.away);
      if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals) || homeGoals < 0 || awayGoals < 0) {
        alert(`Bitte ein gueltiges Ergebnis fuer ${p.homeTeam} vs ${p.awayTeam} eintragen.`);
        return;
      }
      newResults.push({ homeTeam: p.homeTeam, awayTeam: p.awayTeam, homeGoals, awayGoals });

      const actualOutcome = homeGoals > awayGoals ? "H" : homeGoals === awayGoals ? "D" : "A";
      const predictedOutcome =
        p.homeWinProb > p.drawProb && p.homeWinProb > p.awayWinProb ? "H" : p.drawProb > p.awayWinProb ? "D" : "A";
      if (predictedOutcome === actualOutcome) correct++;
    }

    const updatedResults = [...simResultsSoFar, ...newResults];
    const updatedHits = { correct: simHits.correct + correct, total: simHits.total + newResults.length };
    const nextMatchday = simMatchday + 1;

    setSimResultsSoFar(updatedResults);
    setSimHits(updatedHits);
    setSimMatchday(nextMatchday);

    // Immer neu laden, auch ueber den letzten Spieltag hinaus (liefert dann leere predictions,
    // aber die Tabelle wird korrekt aus allen eingetragenen Ergebnissen neu berechnet -- sonst
    // bleibt die Tabelle nach dem letzten Spieltag auf dem Stand des vorletzten stehen und der
    // "weiter"-Button laesst sich unbegrenzt weiterklicken.
    await loadSimMatchday(nextMatchday, updatedResults);
  }

  function resetSim() {
    if (!confirm("Simulation wirklich zuruecksetzen?")) return;
    localStorage.removeItem(SIM_STORAGE_KEY);
    setSimResultsSoFar([]);
    setSimMatchday(1);
    setSimHits({ correct: 0, total: 0 });
    setSimData(null);
    loadSimMatchday(1, []);
  }

  async function runBacktest(schemeKey = scheme) {
    setBacktestLoading(true);
    const res = await fetch(`/api/backtest?scheme=${schemeKey}&tip=ev`);
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

      <div className="tab-bar">
        <button className={`tab ${tab === "predictions" ? "active" : ""}`} onClick={() => setTab("predictions")}>
          Tipps
        </button>
        <button className={`tab ${tab === "table" ? "active" : ""}`} onClick={() => setTab("table")}>
          Tabelle
        </button>
        <button className={`tab ${tab === "backtest" ? "active" : ""}`} onClick={() => setTab("backtest")}>
          Backtest
        </button>
        <button className={`tab ${tab === "simulate" ? "active" : ""}`} onClick={() => setTab("simulate")}>
          Simulieren
        </button>
      </div>

      {tab === "predictions" && (
      <section className="section">
        <div className="section-header">
          <div>
            <h2 className="section-title">Spieltag-Tipps</h2>
            {data?.nextMatchday != null && data.matchday === data.nextMatchday && (
              <p className="section-subtitle">Nächster Spieltag</p>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select className="select" value={scheme} onChange={(e) => changeScheme(e.target.value)}>
              {Object.values(SCORING_SCHEMES).map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
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
            <button className="button secondary" onClick={refreshOdds} disabled={oddsRefreshLoading}>
              {oddsRefreshLoading ? "Holt Quoten …" : "Quoten aktualisieren"}
            </button>
            <button className="button secondary" onClick={refreshLlm} disabled={llmRefreshLoading}>
              {llmRefreshLoading ? "Recherchiert …" : "Spielkontext recherchieren"}
            </button>
          </div>
        </div>

        {oddsRefreshMessage && <p className="refresh-message">{oddsRefreshMessage}</p>}
        {llmRefreshMessage && <p className="refresh-message">{llmRefreshMessage}</p>}
        {data?.llmFetchedAt && (
          <p className="section-subtitle">
            Spielkontext-Stand: {new Date(data.llmFetchedAt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}
            {data.llmModel ? ` · ${data.llmModel}` : ""}
          </p>
        )}
        {data?.oddsFetchedAt && (
          <p className="section-subtitle">
            Quoten-Stand: {new Date(data.oddsFetchedAt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}
          </p>
        )}

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
      )}

      {tab === "table" && (
      <section className="section">
        <div className="section-header">
          <div>
            <h2 className="section-title">Tabelle</h2>
            <p className="section-subtitle">{table ? `Saison ${table.season}/${Number(table.season) + 1}` : "Aktuelle Bundesliga-Tabelle"}</p>
          </div>
        </div>

        {tableLoading && !table && <p className="loading-text">Lade Tabelle …</p>}

        {table && <LeagueTableView rows={table.table} dimmed={tableLoading} />}
      </section>
      )}

      {tab === "simulate" && (
      <section className="section">
        <div className="section-header">
          <div>
            <h2 className="section-title">Saison 26/27 simulieren</h2>
            <p className="section-subtitle">
              Nur Modell + Form (Tordifferenz statt echtem xG, keine Wettquoten) ·{" "}
              {simData && simData.predictions.length === 0
                ? "Saison beendet"
                : `Spieltag ${simMatchday}${simData ? ` von ${simData.totalMatchdays}` : ""}`}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {simHits.total > 0 && (
              <span className="section-subtitle">
                Tendenz bisher: {simHits.correct}/{simHits.total} ({Math.round((simHits.correct / simHits.total) * 100)}%)
              </span>
            )}
            <button className="button secondary" onClick={resetSim}>
              Zurücksetzen
            </button>
          </div>
        </div>

        {simLoading && !simData && <p className="loading-text">Lade Simulation …</p>}

        {simData && simData.predictions.length > 0 && (
          <div className="card-list" style={{ opacity: simLoading ? 0.5 : 1 }}>
            {simData.predictions.map((p) => {
              const key = `${p.homeTeam}|${p.awayTeam}`;
              const input = simInputs[key] ?? { home: "", away: "" };
              return (
                <div className="match-card" key={key}>
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
                      <span className="match-vs">
                        <input
                          type="number"
                          min={0}
                          className="score-input"
                          value={input.home}
                          onChange={(e) => updateSimInput(p.homeTeam, p.awayTeam, "home", e.target.value)}
                        />
                        :
                        <input
                          type="number"
                          min={0}
                          className="score-input"
                          value={input.away}
                          onChange={(e) => updateSimInput(p.homeTeam, p.awayTeam, "away", e.target.value)}
                        />
                      </span>
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
                      <div className="prob-bar-segment home" style={{ width: `${Math.round(p.homeWinProb * 100)}%` }}>
                        <span className="letter">H</span>
                        {Math.round(p.homeWinProb * 100)}%
                      </div>
                      <div className="prob-bar-segment draw" style={{ width: `${Math.round(p.drawProb * 100)}%` }}>
                        <span className="letter">U</span>
                        {Math.round(p.drawProb * 100)}%
                      </div>
                      <div className="prob-bar-segment away" style={{ width: `${Math.round(p.awayWinProb * 100)}%` }}>
                        <span className="letter">A</span>
                        {Math.round(p.awayWinProb * 100)}%
                      </div>
                    </div>
                  </div>

                  <div className="match-side">
                    <span className="tip-badge">Tipp {p.tip}</span>
                    <span className="expected-score">
                      EV {p.expectedPoints.toFixed(2)} Pkt
                    </span>
                    <span className="expected-score">
                      Ø {p.expectedHomeGoals.toFixed(1)}:{p.expectedAwayGoals.toFixed(1)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {simData && simData.predictions.length > 0 && (
          <button className="button" onClick={submitSimMatchday} disabled={simLoading} style={{ marginTop: 12 }}>
            Ergebnisse übernehmen &amp; weiter
          </button>
        )}

        {simData && simData.predictions.length === 0 && (
          <p className="loading-text">Saison komplett simuliert.</p>
        )}

        {simData && simData.table.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <h3 className="section-title" style={{ fontSize: 16, marginBottom: 8 }}>
              Tabelle nach Spieltag {simMatchday - 1}
            </h3>
            <LeagueTableView rows={simData.table} dimmed={simLoading} />
          </div>
        )}
      </section>
      )}

      {tab === "backtest" && (
      <section className="section">
        <div className="section-header">
          <div>
            <h2 className="section-title">Backtest</h2>
            <p className="section-subtitle">Modellgüte auf historischen Saisons</p>
          </div>
          <button className="button" onClick={() => runBacktest()} disabled={backtestLoading}>
            {backtestLoading ? "Läuft …" : backtest ? "Neu berechnen" : "Starten"}
          </button>
        </div>

        {backtest && (
          <>
            <div className="stat-grid">
              <div className="stat-card wide">
                <p className="stat-label">
                  Gesamt über {backtest.perSeason.length} Saisons ({backtest.totalEvaluated} Spiele) ·
                  Schema {backtest.schemeLabel}
                </p>
                <p className="stat-value">
                  {backtest.overall.pointsPerMatch.toFixed(3)}{" "}
                  <span className="stat-value small" style={{ color: "var(--text-tertiary)" }}>
                    Punkte / Spiel
                  </span>
                </p>
                <p className="stat-value small" style={{ color: "var(--text-secondary)", marginTop: 4 }}>
                  {pct(backtest.totalTendencyAccuracy)} Tendenz ·{" "}
                  {pct(backtest.totalExactScoreAccuracy)} exakt · RPS{" "}
                  {backtest.overall.rps.toFixed(4)}
                </p>
                {backtest.overall.expectedPointsPerMatch != null && (
                  <p className="section-subtitle" style={{ marginTop: 6 }}>
                    Modell erwartet {backtest.overall.expectedPointsPerMatch.toFixed(3)} Punkte/Spiel
                    und holt {backtest.overall.pointsPerMatch.toFixed(3)} — die Differenz ist der
                    Kalibrierungsfehler.
                  </p>
                )}
              </div>
              {backtest.perSeason.map((s) => (
                <div className="stat-card" key={s.season}>
                  <p className="stat-label">Saison {s.season}</p>
                  <p className="stat-value small">
                    {s.pointsPerMatch.toFixed(2)}{" "}
                    <span style={{ color: "var(--text-tertiary)" }}>Pkt</span>
                  </p>
                  <p className="section-subtitle">
                    {pct(s.tendencyAccuracy)} Tendenz · RPS {s.rps.toFixed(3)}
                  </p>
                </div>
              ))}
            </div>

            {backtest.baselines && (
              <>
                <p className="section-subtitle" style={{ marginTop: 20 }}>
                  Vergleichsmaßstäbe (RPS: kleiner ist besser). Die Tendenz-Trefferquoten liegen alle
                  innerhalb ihres Standardfehlers von ±1,0 Prozentpunkten und sind deshalb
                  nicht unterscheidbar — der RPS trennt sie dagegen klar.
                </p>
                <div className="stat-grid">
                  {Object.entries(backtest.baselines).map(([name, b]) => (
                    <div className="stat-card" key={name}>
                      <p className="stat-label">{BASELINE_LABELS[name] ?? name}</p>
                      <p className="stat-value small">
                        {b.rps.toFixed(4)} <span style={{ color: "var(--text-tertiary)" }}>RPS</span>
                      </p>
                      <p className="section-subtitle">{pct(b.tendencyAccuracy)} Tendenz</p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </section>
      )}
    </main>
  );
}

function LeagueTableView({ rows, dimmed }: { rows: TableEntry[]; dimmed: boolean }) {
  return (
    <div className="table-wrap" style={{ opacity: dimmed ? 0.5 : 1 }}>
      <table className="league-table">
        <thead>
          <tr>
            <th className="col-pos">#</th>
            <th className="col-team">Team</th>
            <th>Sp</th>
            <th>S</th>
            <th>U</th>
            <th>N</th>
            <th>Tore</th>
            <th>Diff</th>
            <th>Pkt</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.team}>
              <td className="col-pos">{row.position}</td>
              <td className="col-team">
                <span className="table-team">
                  {row.logo && (
                    <span className="team-logo-badge">
                      <img src={row.logo} alt="" className="team-logo" />
                    </span>
                  )}
                  {row.team}
                </span>
              </td>
              <td>{row.matches}</td>
              <td>{row.won}</td>
              <td>{row.draw}</td>
              <td>{row.lost}</td>
              <td>
                {row.goals}:{row.opponentGoals}
              </td>
              <td>{row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}</td>
              <td className="col-points">{row.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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

        {p.bookmakerOdds && p.bookmakerOdds.length > 0 && (
          <p className="odds-line">
            {p.bookmakerOdds
              .map((b) => `${b.bookmaker}: ${b.oddsHome.toFixed(2)} / ${b.oddsDraw.toFixed(2)} / ${b.oddsAway.toFixed(2)}`)
              .join("  ·  ")}
          </p>
        )}

        {p.marketConstraints && p.marketConstraints.length > 0 && (
          <p className="odds-line">Markt im Tipp: {p.marketConstraints.join(" · ")}</p>
        )}

        {p.llmFactors && p.llmFactors.length > 0 && (
          <div className="odds-line">
            {p.llmFactors.map((factor, i) => (
              <p key={i} style={{ margin: 0 }}>
                {factor}
              </p>
            ))}
            <p style={{ margin: "4px 0 0", color: "var(--text-tertiary)" }}>
              {p.llmBlocked
                ? "Korrektur verworfen (hätte die Tendenz gedreht)"
                : p.llmShrinkFactor != null && p.llmShrinkFactor < 1
                  ? `Korrektur auf ${Math.round(p.llmShrinkFactor * 100)}% gedämpft (Favoritenschutz)`
                  : "Korrektur angewandt"}
              {p.llmSources.length > 0 && ` · ${p.llmSources.length} Quellen`}
            </p>
          </div>
        )}
      </div>

      <div className="match-side">
        <span className="match-date">{formatMatchDate(p.date)}</span>
        <span className="tip-badge">{p.tip}</span>
        <span className="expected-score">EV {p.expectedPoints.toFixed(2)} Pkt</span>
        <span className="expected-score">
          Alt {p.runnerUpTip} ({p.runnerUpExpectedPoints.toFixed(2)})
        </span>
        <span className="expected-score">
          Ø {p.expectedHomeGoals.toFixed(1)}:{p.expectedAwayGoals.toFixed(1)}
        </span>
      </div>
    </div>
  );
}
