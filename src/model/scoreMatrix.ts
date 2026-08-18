// Die Wahrscheinlichkeitsverteilung ueber alle Ergebnisse eines Spiels.
//
// Dichtes Float64Array statt Map<string, number>: die Matrix wird in der
// Hyperparametersuche millionenfach gebaut und ausgewertet, und String-Keys plus
// Map-Lookups dominieren dort die Laufzeit vollstaendig. Nach aussen (API, UI) gibt es
// toScoreMap().

import type { OutcomeProbs } from "../eval/metrics";

export interface ScoreMatrix {
  maxGoals: number;
  // index = h * (maxGoals + 1) + a
  cells: Float64Array;
}

export const DEFAULT_MAX_GOALS = 10;

// Dixon-Coles-Korrektur: in echten Daten kommen 0:0, 1:0, 0:1 und 1:1 etwas anders
// vor, als die (vereinfachende) Annahme unabhaengiger Heim-/Auswaertstore vorhersagt.
export const DEFAULT_RHO = -0.15;

// Genereller Bonus fuer JEDES Unentschieden (0:0, 1:1, 2:2, ...), nicht nur die von
// dixonColesTau abgedeckten Faelle. 1 = kein Effekt.
//
// Stand seit jeher auf 1.2 und war nie gemessen worden. Der erste Messversuch lief auf
// Tippspiel-Punkten, weil der RPS nur die drei aggregierten Ausgaenge bewertet und fuer
// einen Parameter, der Masse INNERHALB einer Tendenz verschiebt, bauartbedingt blind ist.
// Der Befund replizierte sich nicht: +0.052 Punkte/Spiel auf der Validation, +0.006 auf
// dem Testset -- die Richtung stimmte, die Groessenordnung brach auf ein Neuntel ein.
//
// 1.0 steht hier deshalb nicht, weil es messbar besser waere, sondern weil die Daten 1.0
// und 1.2 nicht unterscheiden konnten -- und bei Gleichstand gewinnt das einfachere
// Modell. DRAW_BOOST ist kein Wahrscheinlichkeitsmodell, sondern ein Eingriff: er blaeht
// jede Unentschieden-Zelle auf und drueckt nach der Normalisierung Masse aus Ergebnissen
// wie 2:1 heraus. Mit 1.0 ist er weg, und die Unentschieden-Korrektur macht allein
// dixonColesTau, wo sie hingehoert.
//
// Fuer eine Neumessung gibt es inzwischen die richtige Zielgroesse, und sie braucht kein
// Punkteschema: `npm run tune-model -- --objective=score` bewertet den LogLoss auf dem
// exakten Ergebnis. Das ist eine strikt propere Bewertungsregel, die genau die Dimension
// sieht, um die es bei RHO und DRAW_BOOST geht.
export const DEFAULT_DRAW_BOOST = 1.0;

export function createScoreMatrix(maxGoals: number): ScoreMatrix {
  return { maxGoals, cells: new Float64Array((maxGoals + 1) * (maxGoals + 1)) };
}

export function scoreProb(m: ScoreMatrix, h: number, a: number): number {
  if (h < 0 || a < 0 || h > m.maxGoals || a > m.maxGoals) return 0;
  return m.cells[h * (m.maxGoals + 1) + a];
}

function factorial(n: number): number {
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

function poissonProbability(lambda: number, k: number): number {
  return (Math.exp(-lambda) * lambda ** k) / factorial(k);
}

function dixonColesTau(
  h: number,
  a: number,
  lambdaHome: number,
  lambdaAway: number,
  rho: number
): number {
  if (h === 0 && a === 0) return 1 - lambdaHome * lambdaAway * rho;
  if (h === 0 && a === 1) return 1 + lambdaHome * rho;
  if (h === 1 && a === 0) return 1 + lambdaAway * rho;
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
}

export interface MatrixOptions {
  maxGoals?: number;
  rho?: number;
  drawBoost?: number;
}

// Reihenfolge der Operationen ist absichtlich identisch zur urspruenglichen Fassung in
// predictMatch.ts (h aussen, a innen; erst Poisson-Produkt, dann tau, dann Draw-Boost).
// Gleitkommaaddition ist nicht assoziativ -- eine andere Reihenfolge wuerde die
// historischen Vergleichszahlen in der letzten Nachkommastelle verschieben, und dann
// waere nicht mehr entscheidbar, ob eine spaetere Aenderung wirkt oder nur rundet.
export function buildDixonColesMatrix(
  lambdaHome: number,
  lambdaAway: number,
  options: MatrixOptions = {}
): ScoreMatrix {
  const maxGoals = options.maxGoals ?? DEFAULT_MAX_GOALS;
  const rho = options.rho ?? DEFAULT_RHO;
  const drawBoost = options.drawBoost ?? DEFAULT_DRAW_BOOST;

  const matrix = createScoreMatrix(maxGoals);
  const size = maxGoals + 1;
  let total = 0;

  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const prob =
        poissonProbability(lambdaHome, h) *
        poissonProbability(lambdaAway, a) *
        dixonColesTau(h, a, lambdaHome, lambdaAway, rho) *
        (h === a ? drawBoost : 1);
      matrix.cells[h * size + a] = prob;
      total += prob;
    }
  }

  for (let i = 0; i < matrix.cells.length; i++) matrix.cells[i] /= total;

  return matrix;
}

export function normalize(m: ScoreMatrix): void {
  let total = 0;
  for (let i = 0; i < m.cells.length; i++) total += m.cells[i];
  if (total === 0) return;
  for (let i = 0; i < m.cells.length; i++) m.cells[i] /= total;
}

export function outcomeMasses(m: ScoreMatrix): OutcomeProbs {
  const size = m.maxGoals + 1;
  let homeWinProb = 0;
  let drawProb = 0;
  let awayWinProb = 0;

  for (let h = 0; h <= m.maxGoals; h++) {
    for (let a = 0; a <= m.maxGoals; a++) {
      const p = m.cells[h * size + a];
      if (h > a) homeWinProb += p;
      else if (h === a) drawProb += p;
      else awayWinProb += p;
    }
  }

  return { homeWinProb, drawProb, awayWinProb };
}

// Randverteilung der Torsumme: out[k] = P(Heimtore + Auswaertstore == k).
export function totalGoalsMarginal(m: ScoreMatrix): Float64Array {
  const out = new Float64Array(2 * m.maxGoals + 1);
  const size = m.maxGoals + 1;
  for (let h = 0; h <= m.maxGoals; h++) {
    for (let a = 0; a <= m.maxGoals; a++) out[h + a] += m.cells[h * size + a];
  }
  return out;
}

// Randverteilung der Tordifferenz aus Heimsicht: out[d + maxGoals] = P(Heim - Ausw == d).
export function goalDifferenceMarginal(m: ScoreMatrix): Float64Array {
  const out = new Float64Array(2 * m.maxGoals + 1);
  const size = m.maxGoals + 1;
  for (let h = 0; h <= m.maxGoals; h++) {
    for (let a = 0; a <= m.maxGoals; a++) out[h - a + m.maxGoals] += m.cells[h * size + a];
  }
  return out;
}

// Wahrscheinlichste Einzelzelle. Strikt groesser, damit bei Gleichstand die zuerst
// besuchte Zelle gewinnt (h aufsteigend, dann a aufsteigend).
export function argmaxCell(m: ScoreMatrix): string {
  const size = m.maxGoals + 1;
  let best = -1;
  let bestScore = "0:0";

  for (let h = 0; h <= m.maxGoals; h++) {
    for (let a = 0; a <= m.maxGoals; a++) {
      const p = m.cells[h * size + a];
      if (p > best) {
        best = p;
        bestScore = `${h}:${a}`;
      }
    }
  }

  return bestScore;
}

// Erwartungswert der Tore AUS der Matrix. Nach der Dixon-Coles-Korrektur sind das nicht
// mehr exakt die eingesetzten Lambdas -- tau und der Draw-Boost verschieben Masse. Die
// Lambdas daneben anzuzeigen waere deshalb ein Widerspruch zur Verteilung selbst.
export function expectedGoals(m: ScoreMatrix): { home: number; away: number } {
  const size = m.maxGoals + 1;
  let home = 0;
  let away = 0;

  for (let h = 0; h <= m.maxGoals; h++) {
    for (let a = 0; a <= m.maxGoals; a++) {
      const p = m.cells[h * size + a];
      home += h * p;
      away += a * p;
    }
  }

  return { home, away };
}

export function toScoreMap(m: ScoreMatrix): Map<string, number> {
  const size = m.maxGoals + 1;
  const map = new Map<string, number>();
  for (let h = 0; h <= m.maxGoals; h++) {
    for (let a = 0; a <= m.maxGoals; a++) {
      map.set(`${h}:${a}`, m.cells[h * size + a]);
    }
  }
  return map;
}

// Die ersten (limit+1)^2 Zellen als dichtes Array -- fuer die Anzeige, nicht fuer die
// Rechnung. Der Rest der Matrix (maxGoals = 10) traegt zusammen weit unter einem
// Prozent und wuerde in einer Heatmap nur leere Zeilen erzeugen.
//
// Index: grid[h][a]. Bewusst KEINE Normalisierung auf den Ausschnitt -- die Zahlen
// sollen dieselben sein wie die, aus denen die Quoten abgeleitet wurden.
export function toScoreGrid(m: ScoreMatrix, limit: number): number[][] {
  const rows: number[][] = [];
  const bound = Math.min(limit, m.maxGoals);
  for (let h = 0; h <= bound; h++) {
    const row: number[] = [];
    for (let a = 0; a <= bound; a++) row.push(scoreProb(m, h, a));
    rows.push(row);
  }
  return rows;
}
