// Das wahrscheinlichste Ergebnis je Ausgang: bester Heimsieg, bestes Remis, bester
// Auswaertssieg.
//
// "Haeufigstes" ist in drei von vier Spielen 1:1, auch wenn der Favorit zu 60 Prozent
// gewinnt. Das ist kein Fehler. Ein Remis hat je Torniveau genau eine Zelle, ein Sieg
// verteilt sich auf viele, und deshalb gewinnt die Einzelzelle 1:1 fast immer. Gemessen am
// 18.11.2026 (walk-forward, Validation, 1530 Spiele): die 1:1-Zelle ist kalibriert, und
// keine andere Regel trifft das exakte Ergebnis oefter als der Modus. Was die eine Zahl
// verschweigt, ist, WIE der Favorit gewinnt, wenn er gewinnt.
//
// Hier wird nichts umgewichtet und nichts nachgerechnet, nur gesucht. Zuerst in der
// Ergebnisliste des Preisblatts: sie ist absteigend sortiert, der erste Eintrag eines
// Ausgangs ist also dessen Maximum ueber die ganze Matrix. Kommt ein Ausgang dort gar nicht
// vor, im Ausschnitt 0-5 -- ein Ausgang ohne einen einzigen Platz unter den ersten 20 hat
// sein Maximum bei kleinen Torzahlen. Damit ist das Ergebnis bei eingefrorenen Partien eine
// exakte Umformung des Schnappschusses, und das haeufigste Ergebnis ist immer eines der drei.
//
// Logzeilen fuehren nur die zehn wahrscheinlichsten Ergebnisse und keinen Ausschnitt. Fehlt
// ein Ausgang dort, bleibt er leer. Geraten wird nicht.

import { pct } from "./format";

export type OutcomeSide = "home" | "draw" | "away";

export interface OutcomeScore {
  score: string;
  prob: number;
}

export type ScoresByOutcome = Record<OutcomeSide, OutcomeScore | null>;

// Die Felder aus CorrectScorePrice, die hier gebraucht werden.
export interface ListedScore {
  score: string;
  homeGoals: number;
  awayGoals: number;
  price: { prob: number };
}

export function sideOf(homeGoals: number, awayGoals: number): OutcomeSide {
  return homeGoals > awayGoals ? "home" : homeGoals === awayGoals ? "draw" : "away";
}

export function scoresByOutcome(
  listed: readonly ListedScore[],
  grid: readonly (readonly number[])[]
): ScoresByOutcome {
  const best: ScoresByOutcome = { home: null, draw: null, away: null };

  for (const c of listed) {
    const side = sideOf(c.homeGoals, c.awayGoals);
    if (best[side] === null) best[side] = { score: c.score, prob: c.price.prob };
  }

  // Nur fuer Ausgaenge, die die Liste nicht kennt. Reihenfolge (Heimtore aufsteigend, dann
  // Auswaertstore) und striktes Groesser wie argmaxCell, damit ein Gleichstand ueberall
  // gleich aufgeloest wird.
  const known = { home: best.home !== null, draw: best.draw !== null, away: best.away !== null };
  for (let h = 0; h < grid.length; h++) {
    for (let a = 0; a < grid[h].length; a++) {
      const side = sideOf(h, a);
      if (known[side]) continue;
      const p = grid[h][a];
      const current = best[side];
      if (p > 0 && (current === null || p > current.prob)) best[side] = { score: `${h}:${a}`, prob: p };
    }
  }

  return best;
}

// " · 12%" hinter dem haeufigsten Ergebnis. Die Zahl gehoert dazu, erst sie zeigt, wie knapp
// die Spitze ist: in fast der Haelfte der Spiele liegt das zweitwahrscheinlichste Ergebnis
// keine zwei Prozentpunkte dahinter (Validation, 1530 Spiele).
export function modeSuffix(scores: ScoresByOutcome, mostLikelyScore: string): string {
  const mode = [scores.home, scores.draw, scores.away].find((s) => s?.score === mostLikelyScore);
  return mode ? ` · ${pct(mode.prob)}` : "";
}
