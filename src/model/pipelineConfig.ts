// Alle Stellschrauben der Vorhersage an einem Ort, plus ein Hash darueber.
//
// Der Hash ist nicht Deko: das Vorwaerts-Log (data/forward_log.jsonl) schreibt ihn in
// jede Zeile. Aendert sich die Pipeline mitten in der Saison, wuerde ein spaeterer
// gepaarter Vergleich sonst still zwei verschiedene Populationen vermischen und ein
// Ergebnis liefern, das nichts bedeutet. forwardEval.ts gruppiert deshalb nach configHash
// und weigert sich, ohne ausdrueckliches --pool darueber hinweg zu mitteln.
//
// Die frueheren Marktfelder (oddsBlendAlpha, useTotals, useSpread, marketStrength) sind
// entfallen. Damit aendert sich der Hash gegenueber allen bisher geloggten Zeilen -- das
// ist beabsichtigt und korrekt: es IST eine andere Pipeline, und die alten Zeilen duerfen
// nicht mit den neuen in einen Topf.

import { DEFAULT_DRAW_BOOST, DEFAULT_MAX_GOALS, DEFAULT_RHO } from "./scoreMatrix";
import { SEASON_RECENCY_WEIGHTS } from "./teamStrength";
import { XG_FORM_WEIGHT, XG_FORM_WINDOW } from "./xgForm";

export interface PipelineConfig {
  // Fit
  ridgePseudoMatches: number;
  seasonRecencyWeights: number[];
  // Form
  xgFormWindow: number;
  xgFormWeight: number;
  // Matrix
  maxGoals: number;
  rho: number;
  drawBoost: number;
}

// Exakt die aktuell produktiven Werte.
export const DEFAULT_PIPELINE: PipelineConfig = {
  ridgePseudoMatches: 0,
  seasonRecencyWeights: SEASON_RECENCY_WEIGHTS,
  xgFormWindow: XG_FORM_WINDOW,
  xgFormWeight: XG_FORM_WEIGHT,
  maxGoals: DEFAULT_MAX_GOALS,
  rho: DEFAULT_RHO,
  drawBoost: DEFAULT_DRAW_BOOST,
};

// FNV-1a, 32 Bit. Kurz genug zum Lesen im Log, kollisionsfrei genug fuer eine Handvoll
// Konfigurationen pro Saison.
export function configHash(config: PipelineConfig = DEFAULT_PIPELINE): string {
  const json = JSON.stringify([
    config.ridgePseudoMatches,
    config.seasonRecencyWeights,
    config.xgFormWindow,
    config.xgFormWeight,
    config.maxGoals,
    config.rho,
    config.drawBoost,
  ]);

  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
