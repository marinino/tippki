import type { MatchPrediction } from "./predictMatch";

// Per Backtest ermittelter Blend-Anteil (src/scripts/backtestOdds.ts): 50/50 Mischung aus
// Modell- und Bet365-Marktwahrscheinlichkeit lieferte die beste Tendenz-Trefferquote
// (53.0% vs. 52.5% bei reinem Modell, ueber 8 Saisons / 2448 Spiele).
export const ODDS_BLEND_ALPHA = 0.5;

export interface MarketProbabilities {
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
}

// Wandelt Dezimalquoten in Wahrscheinlichkeiten um und entfernt den Buchmacher-Overround
// (die Roh-Kehrwerte summieren sich wegen der Buchmachermarge auf >1, z.B. 1.05).
export function impliedProbabilities(oddsHome: number, oddsDraw: number, oddsAway: number): MarketProbabilities {
  const rawHome = 1 / oddsHome;
  const rawDraw = 1 / oddsDraw;
  const rawAway = 1 / oddsAway;
  const overround = rawHome + rawDraw + rawAway;

  return {
    homeWinProb: rawHome / overround,
    drawProb: rawDraw / overround,
    awayWinProb: rawAway / overround,
  };
}

// Mittelt die (jeweils overround-bereinigten) Marktwahrscheinlichkeiten mehrerer Buchmacher --
// robuster als ein einzelner Buchmacher, da einzelne Ausreisser-Quoten weniger stark durchschlagen.
export function averageMarketProbabilities(
  bookmakers: { oddsHome: number; oddsDraw: number; oddsAway: number }[]
): MarketProbabilities {
  const probs = bookmakers.map((b) => impliedProbabilities(b.oddsHome, b.oddsDraw, b.oddsAway));
  return {
    homeWinProb: probs.reduce((sum, p) => sum + p.homeWinProb, 0) / probs.length,
    drawProb: probs.reduce((sum, p) => sum + p.drawProb, 0) / probs.length,
    awayWinProb: probs.reduce((sum, p) => sum + p.awayWinProb, 0) / probs.length,
  };
}

// Mischt die Modell-Wahrscheinlichkeiten mit den (overround-bereinigten) Marktwahrscheinlichkeiten.
// alpha = 0 -> nur Modell, alpha = 1 -> nur Markt.
export function blendWithMarket(
  prediction: Pick<MatchPrediction, "homeWinProb" | "drawProb" | "awayWinProb">,
  market: MarketProbabilities,
  alpha: number
): MarketProbabilities {
  return {
    homeWinProb: (1 - alpha) * prediction.homeWinProb + alpha * market.homeWinProb,
    drawProb: (1 - alpha) * prediction.drawProb + alpha * market.drawProb,
    awayWinProb: (1 - alpha) * prediction.awayWinProb + alpha * market.awayWinProb,
  };
}

// Alternative zu blendWithMarket: logarithmisches statt lineares Pooling
// (p_i ∝ p_modell_i^(1-alpha) * p_markt_i^alpha, renormalisiert). Reagiert staerker auf Faelle,
// in denen sich Modell und Markt einig sind, und schwaecher auf Ausreisser als der lineare Blend.
export function logPoolWithMarket(
  prediction: Pick<MatchPrediction, "homeWinProb" | "drawProb" | "awayWinProb">,
  market: MarketProbabilities,
  alpha: number
): MarketProbabilities {
  const rawHome = prediction.homeWinProb ** (1 - alpha) * market.homeWinProb ** alpha;
  const rawDraw = prediction.drawProb ** (1 - alpha) * market.drawProb ** alpha;
  const rawAway = prediction.awayWinProb ** (1 - alpha) * market.awayWinProb ** alpha;
  const total = rawHome + rawDraw + rawAway;

  return {
    homeWinProb: rawHome / total,
    drawProb: rawDraw / total,
    awayWinProb: rawAway / total,
  };
}
