"use client";

import { useCallback, useEffect, useState } from "react";
import type { SimResponse, SimResult } from "../types";

const STORAGE_KEY = "tippki-simulation";

export interface SimInput {
  home: string;
  away: string;
}

export function fixtureKey(homeTeam: string, awayTeam: string): string {
  return `${homeTeam}|${awayTeam}`;
}

export function useSimulation() {
  const [resultsSoFar, setResultsSoFar] = useState<SimResult[]>([]);
  const [matchday, setMatchday] = useState(1);
  const [data, setData] = useState<SimResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [inputs, setInputs] = useState<Record<string, SimInput>>({});
  const [hits, setHits] = useState({ correct: 0, total: 0 });
  const [restored, setRestored] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const saved = JSON.parse(raw);
        setResultsSoFar(saved.resultsSoFar ?? []);
        setMatchday(saved.matchday ?? 1);
        setHits(saved.hits ?? { correct: 0, total: 0 });
      } catch {
        // ignorieren, mit leerer Simulation starten
      }
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ resultsSoFar, matchday, hits }));
  }, [resultsSoFar, matchday, hits, restored]);

  const loadMatchday = useCallback(
    async (targetMatchday: number, soFar: SimResult[]) => {
      setLoading(true);
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchday: targetMatchday, resultsSoFar: soFar }),
      });
      const result: SimResponse = await res.json();
      setData(result);
      const prefill: Record<string, SimInput> = {};
      for (const p of result.predictions) {
        const [home, away] = p.mostLikelyScore.split(":");
        prefill[fixtureKey(p.homeTeam, p.awayTeam)] = { home, away };
      }
      setInputs(prefill);
      setLoading(false);
    },
    []
  );

  const updateInput = useCallback(
    (homeTeam: string, awayTeam: string, side: "home" | "away", value: string) => {
      const key = fixtureKey(homeTeam, awayTeam);
      setInputs((prev) => ({ ...prev, [key]: { ...prev[key], [side]: value } }));
      setError(null);
    },
    []
  );

  const submit = useCallback(async () => {
    if (!data) return;
    const newResults: SimResult[] = [];
    let correct = 0;

    for (const p of data.predictions) {
      const input = inputs[fixtureKey(p.homeTeam, p.awayTeam)];
      const homeGoals = Number(input?.home);
      const awayGoals = Number(input?.away);
      if (
        input?.home === "" ||
        input?.away === "" ||
        !Number.isFinite(homeGoals) ||
        !Number.isFinite(awayGoals) ||
        homeGoals < 0 ||
        awayGoals < 0
      ) {
        setError(`Bitte ein gültiges Ergebnis für ${p.homeTeam} — ${p.awayTeam} eintragen.`);
        return;
      }
      newResults.push({ homeTeam: p.homeTeam, awayTeam: p.awayTeam, homeGoals, awayGoals });

      const actualOutcome = homeGoals > awayGoals ? "H" : homeGoals === awayGoals ? "D" : "A";
      const predictedOutcome =
        p.homeWinProb > p.drawProb && p.homeWinProb > p.awayWinProb
          ? "H"
          : p.drawProb > p.awayWinProb
            ? "D"
            : "A";
      if (predictedOutcome === actualOutcome) correct++;
    }

    setError(null);
    const updatedResults = [...resultsSoFar, ...newResults];
    const nextMatchday = matchday + 1;

    setResultsSoFar(updatedResults);
    setHits({ correct: hits.correct + correct, total: hits.total + newResults.length });
    setMatchday(nextMatchday);

    // Immer neu laden, auch ueber den letzten Spieltag hinaus (liefert dann leere
    // predictions, aber die Tabelle wird korrekt aus allen eingetragenen Ergebnissen neu
    // berechnet -- sonst bleibt die Tabelle nach dem letzten Spieltag auf dem Stand des
    // vorletzten stehen und der "weiter"-Knopf laesst sich unbegrenzt weiterklicken.
    await loadMatchday(nextMatchday, updatedResults);
  }, [data, inputs, resultsSoFar, matchday, hits, loadMatchday]);

  const reset = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setResultsSoFar([]);
    setMatchday(1);
    setHits({ correct: 0, total: 0 });
    setData(null);
    setError(null);
    loadMatchday(1, []);
  }, [loadMatchday]);

  return {
    resultsSoFar,
    matchday,
    data,
    loading,
    inputs,
    hits,
    restored,
    error,
    loadMatchday,
    updateInput,
    submit,
    reset,
  };
}
