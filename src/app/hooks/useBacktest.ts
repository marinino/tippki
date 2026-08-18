"use client";

import { useCallback, useState } from "react";
import type { BacktestResult } from "../types";

export function useBacktest() {
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/backtest");
    setResult(await res.json());
    setLoading(false);
  }, []);

  return { result, loading, run, hasRun: result !== null };
}
