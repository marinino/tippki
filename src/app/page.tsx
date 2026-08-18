"use client";

import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "./components/AppHeader";
import { BacktestSection } from "./components/BacktestSection";
import { PredictionsSection } from "./components/PredictionsSection";
import { SimulateSection } from "./components/SimulateSection";
import { TabBar } from "./components/TabBar";
import { TableSection } from "./components/TableSection";
import { useBacktest } from "./hooks/useBacktest";
import { usePredictions } from "./hooks/usePredictions";
import { useSimulation } from "./hooks/useSimulation";
import { readUrlState, writeUrlState } from "./lib/urlState";
import { DEFAULT_SCHEME_KEY } from "../eval/scoringScheme";
import type { Tab, TableResponse } from "./types";

export default function Home() {
  // Einmal synchron beim ersten Rendern lesen, damit ein geteilter Link nicht erst mit
  // den Vorgabewerten laedt und dann nachkorrigiert: der Abruf unten startet direkt mit
  // Spieltag und Schema aus der Adresse.
  const [initial] = useState(() => readUrlState("predictions"));
  // Gerendert wird der Tab aus der Adresse dagegen erst nach dem Mounten. Der Server
  // kennt die Adresszeile nicht und liefert immer "predictions"; ein davon abweichender
  // erster Client-Rendergang zerbricht die Hydration.
  const [tab, setTab] = useState<Tab>("predictions");
  const [hydrated, setHydrated] = useState(false);
  const [table, setTable] = useState<TableResponse | null>(null);
  const [tableLoading, setTableLoading] = useState(false);

  const predictions = usePredictions(initial.scheme, initial.matchday);
  const sim = useSimulation(predictions.scheme);
  const backtest = useBacktest();

  const loadTable = useCallback(async () => {
    setTableLoading(true);
    const res = await fetch("/api/table");
    setTable(await res.json());
    setTableLoading(false);
  }, []);

  useEffect(() => {
    if (tab === "table" && !table) loadTable();
  }, [tab, table, loadTable]);

  useEffect(() => {
    setTab(initial.tab);
    setHydrated(true);
  }, [initial.tab]);

  // Erst ab dem zweiten Rendergang schreiben: davor steht im Tab noch der Vorgabewert,
  // und der wuerde den Tab aus einem geteilten Link aus der Adresse loeschen.
  useEffect(() => {
    if (!hydrated) return;
    writeUrlState(
      { tab, scheme: predictions.scheme, matchday: predictions.data?.matchday ?? null },
      DEFAULT_SCHEME_KEY
    );
  }, [hydrated, tab, predictions.scheme, predictions.data?.matchday]);

  // Zuruecktaste: nur der Tab wird zurueckgesetzt. Spieltag und Schema mitzuziehen
  // wuerde bei jedem Schritt neu rechnen lassen, und der Nutzen ist gering.
  useEffect(() => {
    const onPop = () => setTab(readUrlState("predictions").tab);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (tab === "simulate" && sim.restored && !sim.data) {
      sim.loadMatchday(sim.matchday, sim.resultsSoFar);
    }
  }, [tab, sim.restored, sim.data, sim.loadMatchday, sim.matchday, sim.resultsSoFar]);

  // Das Punkteschema bestimmt den optimalen Tipp, nicht nur seine Bewertung -- ein
  // Wechsel muss deshalb neu rechnen lassen, nicht nur die Anzeige umrechnen.
  function changeScheme(schemeKey: string) {
    predictions.setScheme(schemeKey);
    predictions.load(predictions.data?.matchday ?? undefined, schemeKey);
    if (tab === "simulate") sim.loadMatchday(sim.matchday, sim.resultsSoFar, schemeKey);
    if (backtest.hasRun) backtest.run(schemeKey);
  }

  async function refreshResults() {
    await predictions.refreshResults();
    if (tab === "table") await loadTable();
  }

  // Tabelle und Backtest lesen sich in einer schmaleren Spalte besser -- eine
  // 18-zeilige Tabelle auf 1040 px zieht das Auge unnoetig weit nach rechts.
  const narrow = tab === "table" || tab === "backtest";

  return (
    <main className={`page ${narrow ? "narrow" : ""}`}>
      <AppHeader
        onRefresh={refreshResults}
        loading={predictions.results.loading}
        message={predictions.results.message}
      />

      <TabBar active={tab} onChange={setTab} />

      {tab === "predictions" && (
        <PredictionsSection predictions={predictions} onSchemeChange={changeScheme} />
      )}
      {tab === "table" && <TableSection table={table} loading={tableLoading} />}
      {tab === "simulate" && <SimulateSection sim={sim} />}
      {tab === "backtest" && (
        <BacktestSection
          backtest={backtest.result}
          loading={backtest.loading}
          onRun={() => backtest.run(predictions.scheme)}
        />
      )}
    </main>
  );
}
