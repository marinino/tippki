"use client";

import { useCallback, useEffect, useState } from "react";
import { num } from "../lib/format";
import type { PredictionsResponse } from "../types";

// Ein Refresh-Knopf: laeuft gerade, und was zuletzt dabei herauskam.
export interface RefreshState {
  loading: boolean;
  message: string | null;
}

const IDLE: RefreshState = { loading: false, message: null };

// Auf der gehosteten Instanz schreiben die Knoepfe nicht selbst, sondern stossen den
// GitHub-Workflow an. Der laeuft, committet und deployt -- die neuen Zahlen stehen also
// erst in ein bis zwei Minuten hier, und zwar nach einem Neuladen der Seite.
const DISPATCHED =
  "Lauf angestoßen. Die Daten erscheinen nach Commit und Deployment, üblicherweise " +
  "in ein bis zwei Minuten — Seite dann neu laden.";

export function usePredictions(initialMatchday?: number | null) {
  const [data, setData] = useState<PredictionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState<RefreshState>(IDLE);
  const [llm, setLlm] = useState<RefreshState>(IDLE);

  const load = useCallback(async (matchday?: number) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (matchday) params.set("matchday", String(matchday));
    const res = await fetch(`/api/predictions?${params}`);
    setData(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    // Der Spieltag aus der Adresse gilt nur beim ersten Laden; danach fuehrt die
    // Auswahl im Kopf.
    load(initialMatchday ?? undefined);
    // Nur beim ersten Rendern -- spaetere Laeufe stossen die Handler unten an.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Gemeinsamer Ablauf beider Aktualisierungsknoepfe: sperren, POST, Meldung setzen,
  // Vorhersagen neu laden.
  const runRefresh = useCallback(
    async (
      endpoint: string,
      setState: (s: RefreshState) => void,
      describe: (result: Record<string, unknown>) => string,
      fallback: string
    ) => {
      setState({ loading: true, message: null });
      try {
        const res = await fetch(endpoint, { method: "POST" });
        const result = await res.json();
        if (!res.ok) throw new Error((result.error as string) ?? fallback);
        setState({ loading: false, message: describe(result) });
        return result;
      } catch (err) {
        setState({ loading: false, message: err instanceof Error ? err.message : fallback });
        return null;
      }
    },
    []
  );

  const refreshResults = useCallback(async () => {
    const result = await runRefresh(
      "/api/refresh",
      setResults,
      (r) =>
        r.dispatched
          ? DISPATCHED
          : `${r.resultsCount} Ergebnisse, ${r.xgCount} xG-Spiele aktualisiert` +
            (r.oddsCount === null ? "" : `, ${r.oddsCount} Spiele mit Buchmacher-Schlussquote`),
      "Fehler beim Aktualisieren"
    );
    // Nach einem angestossenen Lauf gibt es hier noch nichts Neues zu holen -- die Daten
    // erscheinen erst nach Commit und Deployment.
    if (result && !result.dispatched) await load(data?.matchday ?? undefined);
    return result;
  }, [runRefresh, load, data?.matchday]);

  // Kostet echtes Geld (gemessen rund 0,37 $ fuer neun Partien), deshalb nur auf Knopfdruck.
  const refreshLlm = useCallback(async () => {
    const result = await runRefresh(
      "/api/refresh-llm",
      setLlm,
      (r) => {
        if (r.dispatched) return DISPATCHED;
        const failed = Object.keys((r.failures as Record<string, unknown>) ?? {}).length;
        return (
          `Spieltag ${r.matchday}: ${r.fixturesWithContext}/${r.fixturesTotal} recherchiert, ` +
          `${r.fixturesWithFactors} mit Faktoren` +
          (failed > 0 ? `, ${failed} fehlgeschlagen` : "") +
          ` · ${num(r.estimatedCostUsd as number, 2)} USD`
        );
      },
      "Fehler beim Recherchieren"
    );
    if (result && !result.dispatched) await load(data?.matchday ?? undefined);
  }, [runRefresh, load, data?.matchday]);

  return { data, loading, load, results, llm, refreshResults, refreshLlm };
}
