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
import type { Tab, TableResponse } from "./types";

export default function Home() {
  // Einmal synchron beim ersten Rendern lesen, damit ein geteilter Link nicht erst mit
  // den Vorgabewerten laedt und dann nachkorrigiert.
  const [initial] = useState(() => readUrlState("predictions"));
  const [tab, setTab] = useState<Tab>(initial.tab);
  const [table, setTable] = useState<TableResponse | null>(null);
  const [tableLoading, setTableLoading] = useState(false);

  const predictions = usePredictions(initial.matchday);
  const sim = useSimulation();
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
    writeUrlState({ tab, matchday: predictions.data?.matchday ?? null });
  }, [tab, predictions.data?.matchday]);

  // Zuruecktaste: nur der Tab wird zurueckgesetzt. Den Spieltag mitzuziehen wuerde bei
  // jedem Schritt neu rechnen lassen, und der Nutzen ist gering.
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

      {tab === "predictions" && <PredictionsSection predictions={predictions} />}
      {tab === "table" && <TableSection table={table} loading={tableLoading} />}
      {tab === "simulate" && <SimulateSection sim={sim} />}
      {tab === "backtest" && (
        <BacktestSection
          backtest={backtest.result}
          loading={backtest.loading}
          onRun={() => backtest.run()}
        />
      )}
    </main>
  );
}
