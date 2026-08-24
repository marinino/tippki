"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminBar } from "./components/AdminBar";
import { AppHeader } from "./components/AppHeader";
import { BacktestSection } from "./components/BacktestSection";
import { DataPanel } from "./components/DataPanel";
import { PredictionsSection } from "./components/PredictionsSection";
import { SimulateSection } from "./components/SimulateSection";
import { TabBar } from "./components/TabBar";
import { TableSection } from "./components/TableSection";
import { useAdmin } from "./hooks/useAdmin";
import { useBacktest } from "./hooks/useBacktest";
import { usePredictions } from "./hooks/usePredictions";
import { useSimulation } from "./hooks/useSimulation";
import { readUrlState, writeUrlState } from "./lib/urlState";
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

  const predictions = usePredictions(initial.matchday);
  const sim = useSimulation();
  const backtest = useBacktest();
  const admin = useAdmin();

  // Lokal immer, gehostet nur angemeldet. Die Sperre selbst sitzt in den Routen -- hier
  // geht es nur darum, keinen Knopf zu zeigen, der ohnehin 403 liefern wuerde.
  const canRefresh = predictions.data?.readOnly === false || admin.state.admin;

  // Ein geteilter Link auf ?tab=daten darf bei einem nicht angemeldeten Leser nicht in
  // einer leeren Seite enden. Der Reiter existiert fuer ihn nicht, also der Vorgabewert.
  const sichtbarerTab: Tab = tab === "data" && !admin.state.admin ? "predictions" : tab;

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
    writeUrlState({ tab, matchday: predictions.data?.matchday ?? null });
  }, [hydrated, tab, predictions.data?.matchday]);

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
        canRefresh={canRefresh}
      />

      <AdminBar admin={admin} />

      <TabBar active={sichtbarerTab} onChange={setTab} admin={admin.state.admin} />

      {sichtbarerTab === "predictions" && (
        <PredictionsSection predictions={predictions} canRefresh={canRefresh} />
      )}
      {sichtbarerTab === "table" && <TableSection table={table} loading={tableLoading} />}
      {sichtbarerTab === "simulate" && <SimulateSection sim={sim} />}
      {sichtbarerTab === "backtest" && (
        <BacktestSection
          backtest={backtest.result}
          loading={backtest.loading}
          onRun={() => backtest.run()}
        />
      )}
      {sichtbarerTab === "data" && <DataPanel />}
    </main>
  );
}
