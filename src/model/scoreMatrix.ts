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
export const DEFAULT_DRAW_BOOST = 1.2;

export function createScoreMatrix(maxGoals: number): ScoreMatrix {
  return { maxGoals, cells: new Float64Array((maxGoals + 1) * (maxGoals + 1)) };
}

export function cloneMatrix(m: ScoreMatrix): ScoreMatrix {
  return { maxGoals: m.maxGoals, cells: Float64Array.from(m.cells) };
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

// Argmax-Zelle -- der bisherige "Tipp". Strikt groesser, damit bei Gleichstand die
// zuerst besuchte Zelle gewinnt (h aufsteigend, dann a aufsteigend), genau wie vorher.
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

// Verschiebt die Matrix so, dass die drei Ausgangsgruppen exakt die vorgegebenen Massen
// tragen -- jede Zelle einer Gruppe wird mit target_g / aktuelleMasse_g multipliziert.
//
// Das ist keine Heuristik: unter allen Verteilungen, die diese drei Randbedingungen
// erfuellen, ist das die eindeutige mit minimaler KL-Divergenz zur Ausgangsmatrix. Die
// Form INNERHALB einer Gruppe bleibt exakt erhalten, nur das Gewicht zwischen den
// Gruppen verschiebt sich.
//
// Damit landet die Marktinformation endlich auch im Ergebnistipp. Bisher wurden nur die
// aggregierten 1X2-Balken geblendet, waehrend der angezeigte Tipp aus der unveraenderten
// Modellmatrix kam -- die beiden Anzeigen konnten sich also widersprechen.
export function reweightToOutcomeMasses(m: ScoreMatrix, target: OutcomeProbs): ScoreMatrix {
  const current = outcomeMasses(m);

  // Bei lambda > 0 kann keine Gruppenmasse 0 sein; falls doch, waere der Faktor
  // undefiniert und wir liefern die Matrix unveraendert zurueck.
  if (current.homeWinProb <= 0 || current.drawProb <= 0 || current.awayWinProb <= 0) {
    return cloneMatrix(m);
  }

  const factorHome = target.homeWinProb / current.homeWinProb;
  const factorDraw = target.drawProb / current.drawProb;
  const factorAway = target.awayWinProb / current.awayWinProb;

  const size = m.maxGoals + 1;
  const out = createScoreMatrix(m.maxGoals);

  for (let h = 0; h <= m.maxGoals; h++) {
    for (let a = 0; a <= m.maxGoals; a++) {
      const i = h * size + a;
      out.cells[i] = m.cells[i] * (h > a ? factorHome : h === a ? factorDraw : factorAway);
    }
  }

  return out;
}
