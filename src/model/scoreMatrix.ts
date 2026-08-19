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

// Kalibrierungstemperatur auf den 1X2-Massen. 1 = aus.
//
// Gemessen auf 2290 Spielen: mittlerer Kalibrierungsfehler 2,78 Prozentpunkte gegen 1,11
// beim Buchmacher, auf denselben Spielen. Das Muster ist monoton und einseitig -- hohe
// Wahrscheinlichkeiten zu hoch, niedrige zu niedrig, in der Mitte sitzt es gut. Oberhalb
// von 90 Prozent gibt Pinnacle praktisch nie eine Quote ab (n = 4), das Modell 94-mal.
//
// Gescannt am 2026-08-19 auf VALIDATION (2018-2022, 1529 Spiele), Testset unangetastet:
//
//   T       RPS      LogLoss   O/U      Score     ECE      ΔLogLoss   p
//   1.00    0.2055   1.0035    0.6905   3.1298   2.62pp    —          —
//   1.15    0.2045   0.9966    0.6903   3.1229   1.25pp    +0.0069    <0.0001
//   1.20    0.2044   0.9954    0.6903   3.1218   1.21pp    +0.0080    <0.0001
//   1.30    0.2044   0.9944    0.6902   3.1207   1.80pp    +0.0091    0.0055
//   1.50    0.2049   0.9952    0.6901   3.1216   2.39pp    +0.0082    0.1055
//   Markt   0.2007   0.9802    0.6485      —     1.50pp
//
// Gewaehlt wurde 1.20: das Minimum des Kalibrierungsfehlers, und es liegt auf dem flachen
// Stueck der LogLoss-Kurve (1.15 bis 1.30 sind praktisch gleichauf) statt am Rand des
// Suchbereichs. Die LogLoss-Verbesserung traegt jede einzelne der fuenf Saisons: +0.0059,
// +0.0065, +0.0097, +0.0103, +0.0077 -- keine wird von einer anderen getragen.
//
// Der Kalibrierungsfehler liegt damit UNTER dem des Buchmachers (1.21pp gegen 1.50pp). Das
// heisst ausdruecklich NICHT, dass das Modell den Buchmacher schlaegt: LogLoss und RPS
// bleiben klar schlechter. Kalibrierung sagt, ob 70 Prozent auch in 70 Prozent der Faelle
// eintreten; Trennschaerfe sagt, ob ueberhaupt die richtigen Spiele 70 Prozent bekommen.
// Repariert ist hier nur das Erste.
export const DEFAULT_OUTCOME_TEMPERATURE = 1.2;

// p_i' proportional zu p_i^(1/T), danach renormalisiert. T > 1 zieht zur Gleichverteilung,
// T < 1 schaerft. Der Standardgriff gegen genau diese Verzerrung, und ein einziger
// Parameter -- er kann die REIHENFOLGE der drei Ausgaenge nicht aendern, nur ihren Abstand.
//
// Angewandt wird sie auf die Matrix, nicht auf drei Zahlen daneben: jede Zelle wird mit dem
// Faktor ihres Tendenzblocks multipliziert. Damit bleibt die Form INNERHALB einer Tendenz
// unangetastet (ein Heimsieg faellt weiter eher 2:1 als 5:0 aus), und Preisblatt, Totals,
// Handicap und exaktes Ergebnis bleiben mit den 1X2-Massen konsistent. Drei Zahlen separat
// zu temperieren wuerde dagegen ein Produkt liefern, dessen Teile sich widersprechen.
export function applyOutcomeTemperature(m: ScoreMatrix, temperature: number): void {
  if (!Number.isFinite(temperature) || Math.abs(temperature - 1) < 1e-12) return;

  const before = outcomeMasses(m);
  const raw = [
    before.homeWinProb ** (1 / temperature),
    before.drawProb ** (1 / temperature),
    before.awayWinProb ** (1 / temperature),
  ];
  const sum = raw[0] + raw[1] + raw[2];
  if (!(sum > 0)) return;

  // Ein Block ohne Masse laesst sich nicht skalieren -- dann bleibt die Matrix, wie sie ist,
  // statt durch eine Division durch Null unbrauchbar zu werden.
  const masses = [before.homeWinProb, before.drawProb, before.awayWinProb];
  if (masses.some((p) => p <= 0)) return;
  const factors = raw.map((r, i) => r / sum / masses[i]);

  for (let h = 0; h <= m.maxGoals; h++) {
    for (let a = 0; a <= m.maxGoals; a++) {
      const block = h > a ? 0 : h === a ? 1 : 2;
      m.cells[h * (m.maxGoals + 1) + a] *= factors[block];
    }
  }
  normalize(m);
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
