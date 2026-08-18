"use client";

import { useCallback, useState } from "react";
import type { BacktestResult } from "../types";

export function useBacktest() {
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async (schemeKey: string) => {
    setLoading(true);
    const res = await fetch(`/api/backtest?scheme=${schemeKey}&tip=ev`);
    setResult(await res.json());
    setLoading(false);
  }, []);

  return { result, loading, run, hasRun: result !== null };
}
