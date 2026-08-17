// Marktinformation als Nebenbedingungen auf der Score-Matrix.
//
// Der urspruengliche Plan war, aus Over/Under und Asian Handicap zwei Torerwartungen
// (lambda_heim, lambda_ausw) zurueckzurechnen und die mit dem Modell zu mischen. Die
// Markt-Probe (npx tsx src/scripts/inspectOddsMarkets.ts) hat aber gezeigt, dass Bet365
// live 22 Totals- und 31 Spread-Linien liefert -- daraus laesst sich die komplette
// Randverteilung der Torsumme UND der Tordifferenz ablesen. Zwei Parameter
// zurueckzurechnen waere ein unnoetiger Informationsverlust.
//
// Stattdessen: jede Marktinformation ist eine Partition der Matrixzellen mit vorgegebenen
// Gruppenmassen, und die Matrix wird per Iterative Proportional Fitting auf alle
// Bedingungen gleichzeitig projiziert. Jeder Einzelschritt ist dieselbe KL-minimale
// Umgewichtung wie reweightToOutcomeMasses -- die Form innerhalb einer Gruppe bleibt
// erhalten, nur das Gewicht zwischen den Gruppen verschiebt sich.
//
// Bewusst NICHT verwendet: der "Correct Score"-Markt. Er liefert zwar 40 Ergebnisse
// direkt, hat aber ~41% Overround (Summe der Kehrwerte 1.42 im Stichprobenspiel). Bei so
// einer Marge ist proportionales Entvigen grob falsch, weil Buchmacher Aussenseiter
// staerker belasten als Favoriten. ML (2 Buchmacher) und Totals (3 Buchmacher) liegen bei
// ~5% Overround und sind ungleich verlaesslicher.

import type { OutcomeProbs } from "../eval/metrics";
import { cloneMatrix, createScoreMatrix, type ScoreMatrix } from "./scoreMatrix";

export interface MatrixConstraint {
  name: string;
  groupCount: number;
  // Gruppenindex je Zelle, -1 = von dieser Bedingung nicht erfasst.
  groupOf: Int32Array;
  // Zielmasse je Gruppe. Summiert ueber die erfassten Zellen auf 1.
  targets: Float64Array;
}

// Zweiwege-Entvigen: bei Halblinien (x.5) gibt es kein Push, die beiden Seiten sind also
// komplementaer und die Kehrwerte summieren sich exakt auf den Overround.
export function devigTwoWay(oddsA: number, oddsB: number): number {
  const rawA = 1 / oddsA;
  const rawB = 1 / oddsB;
  return rawA / (rawA + rawB);
}

export function outcomeConstraint(maxGoals: number, probs: OutcomeProbs): MatrixConstraint {
  const size = maxGoals + 1;
  const groupOf = new Int32Array(size * size);

  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      groupOf[h * size + a] = h > a ? 0 : h === a ? 1 : 2;
    }
  }

  return {
    name: "1X2",
    groupCount: 3,
    groupOf,
    targets: Float64Array.from([probs.homeWinProb, probs.drawProb, probs.awayWinProb]),
  };
}

// Eine einzelne Over/Under-Halblinie, z.B. die 2.5 aus den historischen CSVs.
// Gruppe 0 = Summe unter der Linie, Gruppe 1 = darueber.
export function totalOverConstraint(
  maxGoals: number,
  line: number,
  overProb: number
): MatrixConstraint {
  const size = maxGoals + 1;
  const groupOf = new Int32Array(size * size);

  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      groupOf[h * size + a] = h + a > line ? 1 : 0;
    }
  }

  return {
    name: `Total ${line}`,
    groupCount: 2,
    groupOf,
    targets: Float64Array.from([1 - overProb, overProb]),
  };
}

export interface TotalsLine {
  line: number;
  oddsOver: number;
  oddsUnder: number;
}

export interface SpreadLine {
  line: number;
  oddsHome: number;
  oddsAway: number;
}

// Nur Halblinien: dort ist die Wette zweiwertig (kein Push, keine Viertellinien-Aufteilung
// auf zwei Nachbarlinien), und genau dann ist devigTwoWay korrekt. Viertellinien wie 2.25
// waeren eine Linearkombination zweier Bedingungen und passen nicht in eine Partition --
// sie werden verworfen statt falsch behandelt.
function halfLinesOnly<T extends { line: number }>(lines: T[]): T[] {
  return lines
    .filter((l) => Math.abs(l.line % 1) === 0.5)
    .sort((x, y) => x.line - y.line);
}

// Erzwingt Monotonie: P(Summe >= k) muss in k fallen. Die Linien werden unabhaengig
// voneinander entvigt, kleine Verletzungen sind deshalb normal -- ohne diese Korrektur
// entstuenden negative Einzelwahrscheinlichkeiten.
function enforceNonIncreasing(values: number[]): number[] {
  const out = [...values];
  for (let i = 1; i < out.length; i++) {
    if (out[i] > out[i - 1]) out[i] = out[i - 1];
  }
  return out;
}

// Die volle Randverteilung der Torsumme aus einer Totals-Leiter.
// Aus P(Summe > l) fuer l = 0.5, 1.5, ... folgt P(Summe = k) durch Differenzbildung.
export function totalGoalsConstraint(
  maxGoals: number,
  lines: TotalsLine[]
): MatrixConstraint | null {
  const usable = halfLinesOnly(lines).filter((l) => l.line >= 0.5 && l.line <= 2 * maxGoals);
  if (usable.length < 2) return null;

  // thresholds[i] = k bedeutet: P(Summe >= k)
  const thresholds = usable.map((l) => Math.ceil(l.line));
  const overProbs = enforceNonIncreasing(usable.map((l) => devigTwoWay(l.oddsOver, l.oddsUnder)));

  const maxTotal = 2 * maxGoals;
  const highest = thresholds[thresholds.length - 1];

  // Gruppen: 0..highest-1 sind exakte Summen, highest ist der Rest-Schwanz.
  const groupCount = highest + 1;
  const targets = new Float64Array(groupCount);

  // P(Summe >= k) fuer jedes k, das eine Linie belegt; dazwischenliegende k werden
  // linear zwischen den Nachbarn interpoliert.
  const atLeast = new Float64Array(highest + 1);
  atLeast[0] = 1;
  for (let k = 1; k <= highest; k++) {
    const exact = thresholds.indexOf(k);
    if (exact >= 0) {
      atLeast[k] = overProbs[exact];
      continue;
    }
    let lo = -1;
    let hi = -1;
    for (let i = 0; i < thresholds.length; i++) {
      if (thresholds[i] < k) lo = i;
      if (thresholds[i] > k && hi === -1) hi = i;
    }
    if (lo === -1) atLeast[k] = overProbs[hi];
    else if (hi === -1) atLeast[k] = overProbs[lo];
    else {
      const t = (k - thresholds[lo]) / (thresholds[hi] - thresholds[lo]);
      atLeast[k] = overProbs[lo] + t * (overProbs[hi] - overProbs[lo]);
    }
  }

  for (let k = 0; k < highest; k++) targets[k] = atLeast[k] - atLeast[k + 1];
  targets[highest] = atLeast[highest];

  let sum = 0;
  for (const t of targets) {
    if (t < 0) return null;
    sum += t;
  }
  if (sum <= 0) return null;
  for (let i = 0; i < targets.length; i++) targets[i] /= sum;

  const size = maxGoals + 1;
  const groupOf = new Int32Array(size * size);
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      groupOf[h * size + a] = Math.min(h + a, highest);
    }
  }

  return { name: `Totals (${usable.length} Linien)`, groupCount, groupOf, targets, };
}

// Randverteilung der Tordifferenz aus einer Spread-Leiter (Asian Handicap).
// Die Linie ist aus Heimsicht: hdp = -1.5 bedeutet "Heim gewinnt mit mindestens 2 Toren".
export function goalDifferenceConstraint(
  maxGoals: number,
  lines: SpreadLine[]
): MatrixConstraint | null {
  const usable = halfLinesOnly(lines);
  if (usable.length < 2) return null;

  // P(Differenz >= d) fuer d = -hdp + 0.5, aufsteigend nach d sortiert.
  const points = usable
    .map((l) => ({ d: Math.ceil(-l.line), prob: devigTwoWay(l.oddsHome, l.oddsAway) }))
    .sort((x, y) => x.d - y.d);

  const dedup: { d: number; prob: number }[] = [];
  for (const p of points) {
    if (dedup.length > 0 && dedup[dedup.length - 1].d === p.d) continue;
    dedup.push(p);
  }
  if (dedup.length < 2) return null;

  const probs = enforceNonIncreasing(dedup.map((p) => p.prob));
  const lowest = dedup[0].d;
  const highest = dedup[dedup.length - 1].d;

  // Gruppen: 0 = Differenz < lowest, dann je eine Gruppe pro Differenz bis highest-1,
  // letzte Gruppe = Differenz >= highest.
  const groupCount = highest - lowest + 2;
  const targets = new Float64Array(groupCount);

  const atLeast = new Map<number, number>();
  for (let i = 0; i < dedup.length; i++) atLeast.set(dedup[i].d, probs[i]);

  function probAtLeast(d: number): number {
    const exact = atLeast.get(d);
    if (exact !== undefined) return exact;
    let lo = -Infinity;
    let hi = Infinity;
    for (const key of atLeast.keys()) {
      if (key < d && key > lo) lo = key;
      if (key > d && key < hi) hi = key;
    }
    if (lo === -Infinity) return atLeast.get(hi)!;
    if (hi === Infinity) return atLeast.get(lo)!;
    const t = (d - lo) / (hi - lo);
    return atLeast.get(lo)! + t * (atLeast.get(hi)! - atLeast.get(lo)!);
  }

  targets[0] = 1 - probAtLeast(lowest);
  for (let d = lowest; d < highest; d++) {
    targets[d - lowest + 1] = probAtLeast(d) - probAtLeast(d + 1);
  }
  targets[groupCount - 1] = probAtLeast(highest);

  let sum = 0;
  for (const t of targets) {
    if (t < 0) return null;
    sum += t;
  }
  if (sum <= 0) return null;
  for (let i = 0; i < targets.length; i++) targets[i] /= sum;

  const size = maxGoals + 1;
  const groupOf = new Int32Array(size * size);
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const diff = h - a;
      const group = diff < lowest ? 0 : diff >= highest ? groupCount - 1 : diff - lowest + 1;
      groupOf[h * size + a] = group;
    }
  }

  return { name: `Spread (${dedup.length} Linien)`, groupCount, groupOf, targets };
}

export interface IpfOptions {
  maxIterations?: number;
  tolerance?: number;
  // 0 = Bedingungen ignorieren, 1 = voll erzwingen. Dazwischen wird der Korrekturfaktor
  // im Log-Raum abgeschwaecht -- so laesst sich die Marktstaerke als ein einziger
  // Parameter tunen, statt jede Bedingung einzeln zu gewichten.
  strength?: number;
}

export interface IpfResult {
  matrix: ScoreMatrix;
  iterations: number;
  converged: boolean;
  maxDeviation: number;
}

// Iterative Proportional Fitting: reihum auf jede Bedingung projizieren, bis sich nichts
// mehr bewegt. Bei sich nicht widersprechenden Bedingungen konvergiert das gegen die
// eindeutige Verteilung mit minimaler KL-Divergenz zur Ausgangsmatrix, die alle
// Bedingungen erfuellt.
export function applyConstraints(
  input: ScoreMatrix,
  constraints: MatrixConstraint[],
  options: IpfOptions = {}
): IpfResult {
  const maxIterations = options.maxIterations ?? 40;
  const tolerance = options.tolerance ?? 1e-10;
  const strength = options.strength ?? 1;

  if (constraints.length === 0 || strength <= 0) {
    return { matrix: cloneMatrix(input), iterations: 0, converged: true, maxDeviation: 0 };
  }

  const matrix = cloneMatrix(input);
  let maxDeviation = 0;
  let iteration = 0;

  for (; iteration < maxIterations; iteration++) {
    maxDeviation = 0;

    for (const constraint of constraints) {
      const current = new Float64Array(constraint.groupCount);
      let covered = 0;
      for (let i = 0; i < matrix.cells.length; i++) {
        const g = constraint.groupOf[i];
        if (g < 0) continue;
        current[g] += matrix.cells[i];
        covered += matrix.cells[i];
      }
      if (covered <= 0) continue;

      const factors = new Float64Array(constraint.groupCount);
      for (let g = 0; g < constraint.groupCount; g++) {
        const target = constraint.targets[g] * covered;
        if (current[g] <= 0) {
          // Gruppe hat unter dem Modell keine Masse -- ein multiplikativer Faktor kann
          // daran nichts aendern, also unveraendert lassen statt durch 0 zu teilen.
          factors[g] = 1;
          continue;
        }
        const raw = target / current[g];
        factors[g] = strength === 1 ? raw : Math.exp(strength * Math.log(raw));
        maxDeviation = Math.max(maxDeviation, Math.abs(current[g] / covered - constraint.targets[g]));
      }

      for (let i = 0; i < matrix.cells.length; i++) {
        const g = constraint.groupOf[i];
        if (g >= 0) matrix.cells[i] *= factors[g];
      }
    }

    // Nach jedem vollen Durchgang renormalisieren, damit sich Rundungsdrift nicht aufbaut.
    let total = 0;
    for (let i = 0; i < matrix.cells.length; i++) total += matrix.cells[i];
    if (total > 0) {
      for (let i = 0; i < matrix.cells.length; i++) matrix.cells[i] /= total;
    }

    if (maxDeviation < tolerance) {
      iteration++;
      break;
    }
  }

  return { matrix, iterations: iteration, converged: maxDeviation < tolerance, maxDeviation };
}

// Nur fuer den Self-Check und die Diagnose: die Massen einer Bedingung nachrechnen.
export function constraintMasses(m: ScoreMatrix, constraint: MatrixConstraint): Float64Array {
  const masses = new Float64Array(constraint.groupCount);
  for (let i = 0; i < m.cells.length; i++) {
    const g = constraint.groupOf[i];
    if (g >= 0) masses[g] += m.cells[i];
  }
  return masses;
}

export function totalGoalsMarginal(m: ScoreMatrix): Float64Array {
  const out = new Float64Array(2 * m.maxGoals + 1);
  const size = m.maxGoals + 1;
  for (let h = 0; h <= m.maxGoals; h++) {
    for (let a = 0; a <= m.maxGoals; a++) out[h + a] += m.cells[h * size + a];
  }
  return out;
}

export function emptyMatrixLike(m: ScoreMatrix): ScoreMatrix {
  return createScoreMatrix(m.maxGoals);
}
