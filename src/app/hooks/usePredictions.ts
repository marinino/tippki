"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_SCHEME_KEY } from "../../eval/scoringScheme";
import { num } from "../lib/format";
import type { PredictionsResponse } from "../types";

// Ein Refresh-Knopf: laeuft gerade, und was zuletzt dabei herauskam.
export interface RefreshState {
  loading: boolean;
  message: string | null;
}

const IDLE: RefreshState = { loading: false, message: null };

export function usePredictions(initialScheme?: string | null, initialMatchday?: number | null) {
  const [data, setData] = useState<PredictionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [scheme, setScheme] = useState<string>(initialScheme ?? DEFAULT_SCHEME_KEY);
  const [results, setResults] = useState<RefreshState>(IDLE);
  const [odds, setOdds] = useState<RefreshState>(IDLE);
  const [llm, setLlm] = useState<RefreshState>(IDLE);

  const load = useCallback(async (matchday?: number, schemeKey = scheme) => {
    setLoading(true);
    const params = new URLSearchParams({ scheme: schemeKey });
    if (matchday) params.set("matchday", String(matchday));
    const res = await fetch(`/api/predictions?${params}`);
    setData(await res.json());
    setLoading(false);
  }, [scheme]);

  useEffect(() => {
    // Der Spieltag aus der Adresse gilt nur beim ersten Laden; danach fuehrt die
    // Auswahl im Kopf.
    load(initialMatchday ?? undefined);
    // Nur beim ersten Rendern -- spaetere Laeufe stossen die Handler unten an.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Gemeinsamer Ablauf aller drei Aktualisierungsknoepfe: sperren, POST, Meldung
  // setzen, Vorhersagen neu laden. Vorher stand das dreimal fast wortgleich da.
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
      (r) => `${r.resultsCount} Ergebnisse, ${r.xgCount} xG-Spiele aktualisiert`,
      "Fehler beim Aktualisieren"
    );
    if (result) await load(data?.matchday ?? undefined);
    return result;
  }, [runRefresh, load, data?.matchday]);

  const refreshOdds = useCallback(async () => {
    const result = await runRefresh(
      "/api/refresh-odds",
      setOdds,
      (r) => `Spieltag ${r.matchday}: ${r.fixturesWithOdds}/${r.fixturesTotal} Quoten geholt`,
      "Fehler beim Aktualisieren der Quoten"
    );
    if (result) await load(data?.matchday ?? undefined);
  }, [runRefresh, load, data?.matchday]);

  // Kostet echtes Geld (rund 1 $ fuer neun Partien), deshalb nur auf Knopfdruck.
  const refreshLlm = useCallback(async () => {
    const result = await runRefresh(
      "/api/refresh-llm",
      setLlm,
      (r) => {
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
    if (result) await load(data?.matchday ?? undefined);
  }, [runRefresh, load, data?.matchday]);

  return {
    data,
    loading,
    scheme,
    setScheme,
    load,
    results,
    odds,
    llm,
    refreshResults,
    refreshOdds,
    refreshLlm,
  };
}
