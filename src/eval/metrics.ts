// Bewertungsmetriken fuer 1X2-Prognosen.
//
// Warum es diese Datei gibt: bisher wurde ausschliesslich die Tendenz-Trefferquote
// gemessen (argmax der drei Wahrscheinlichkeiten, richtig/falsch). Das wirft die
// gesamte Wahrscheinlichkeitsinformation weg und ist die verrauschteste verfuegbare
// Metrik -- bei 2448 Spielen und p ~ 0.525 betraegt der Standardfehler 1.01
// Prozentpunkte. Unterschiede von 0.2-0.5 Punkten lassen sich damit grundsaetzlich
// nicht von Zufall unterscheiden.
//
// Optimiert wird deshalb auf RPS (Ranked Probability Score); Trefferquote wird nur
// noch berichtet, nie mehr als Zielgroesse verwendet.

export type Outcome = "H" | "D" | "A";

export interface OutcomeProbs {
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
}

export function outcomeOf(homeGoals: number, awayGoals: number): Outcome {
  return homeGoals > awayGoals ? "H" : homeGoals === awayGoals ? "D" : "A";
}

// Tie-Breaking exakt wie in der bisherigen Backtest-Logik: "H" nur, wenn echt groesser
// als beide anderen; sonst "D", wenn echt groesser als "A"; sonst "A". Bei Gleichstand
// gewinnt also die spaetere Option. Das ist willkuerlich, aber es zu aendern wuerde die
// historischen Vergleichszahlen (52.5% / 53.0%) verschieben -- also bleibt es so.
export function argmaxOutcome(p: OutcomeProbs): Outcome {
  if (p.homeWinProb > p.drawProb && p.homeWinProb > p.awayWinProb) return "H";
  if (p.drawProb > p.awayWinProb) return "D";
  return "A";
}

// Ranked Probability Score fuer die drei GEORDNETEN Ausgaenge H < D < A.
// Anders als Brier oder Log-Loss bestraft der RPS eine Fehlprognose danach, wie weit
// sie in der Ordnung danebenliegt: einen Heimsieg als Unentschieden vorherzusagen ist
// weniger falsch, als ihn als Auswaertssieg vorherzusagen. Genau deshalb ist er die
// Standardmetrik fuer Fussball-1X2. 0 = perfekt, 1 = maximal falsch.
export function rankedProbabilityScore(p: OutcomeProbs, actual: Outcome): number {
  const c1 = p.homeWinProb;
  const c2 = p.homeWinProb + p.drawProb;
  const a1 = actual === "H" ? 1 : 0;
  const a2 = actual === "A" ? 0 : 1;
  return ((c1 - a1) ** 2 + (c2 - a2) ** 2) / 2;
}

const LOG_LOSS_FLOOR = 1e-15;

// -ln p(tatsaechlicher Ausgang). Bestraft Ueberzeugung sehr hart und ist damit der
// empfindlichste Kalibrierungsindikator der drei.
export function logLoss(p: OutcomeProbs, actual: Outcome): number {
  const pActual = actual === "H" ? p.homeWinProb : actual === "D" ? p.drawProb : p.awayWinProb;
  return -Math.log(Math.max(pActual, LOG_LOSS_FLOOR));
}

// Mehrklassiger Brier-Score: Summe der quadrierten Abweichungen ueber alle drei Klassen.
export function brierScore(p: OutcomeProbs, actual: Outcome): number {
  const aHome = actual === "H" ? 1 : 0;
  const aDraw = actual === "D" ? 1 : 0;
  const aAway = actual === "A" ? 1 : 0;
  return (
    (p.homeWinProb - aHome) ** 2 + (p.drawProb - aDraw) ** 2 + (p.awayWinProb - aAway) ** 2
  );
}

export interface PerMatchMetrics {
  predicted: Outcome;
  actual: Outcome;
  exactHit: boolean;
  points: number;
  // Vom Modell fuer den abgegebenen Tipp erwartete Punkte. Optional, weil der
  // EV-Tippselektor erst in Phase 1 existiert.
  expectedPoints?: number;
  rps: number;
  logLoss: number;
  brier: number;
}

export interface MetricSummary {
  n: number;
  tendencyAccuracy: number;
  exactScoreRate: number;
  pointsPerMatch: number;
  pointsTotal: number;
  // Null, solange nicht jede Zeile einen Erwartungswert mitbringt.
  expectedPointsPerMatch: number | null;
  rps: number;
  logLoss: number;
  brier: number;
}

const EMPTY_SUMMARY: MetricSummary = {
  n: 0,
  tendencyAccuracy: 0,
  exactScoreRate: 0,
  pointsPerMatch: 0,
  pointsTotal: 0,
  expectedPointsPerMatch: null,
  rps: 0,
  logLoss: 0,
  brier: 0,
};

// Die Luecke zwischen expectedPointsPerMatch und pointsPerMatch ist ein kostenloser
// Kalibrierungstest, den es bisher nirgends gab: erwartet das Modell 1.45 Punkte und
// holt 1.31, ist es ueberzeugt von sich selbst -- und keine Trefferquote haette das gezeigt.
export function summarize(rows: PerMatchMetrics[]): MetricSummary {
  const n = rows.length;
  if (n === 0) return { ...EMPTY_SUMMARY };

  let correct = 0;
  let exact = 0;
  let points = 0;
  let expectedPoints = 0;
  let expectedPointsAvailable = true;
  let rps = 0;
  let ll = 0;
  let brier = 0;

  for (const r of rows) {
    if (r.predicted === r.actual) correct++;
    if (r.exactHit) exact++;
    points += r.points;
    if (r.expectedPoints === undefined) expectedPointsAvailable = false;
    else expectedPoints += r.expectedPoints;
    rps += r.rps;
    ll += r.logLoss;
    brier += r.brier;
  }

  return {
    n,
    tendencyAccuracy: correct / n,
    exactScoreRate: exact / n,
    pointsPerMatch: points / n,
    pointsTotal: points,
    expectedPointsPerMatch: expectedPointsAvailable ? expectedPoints / n : null,
    rps: rps / n,
    logLoss: ll / n,
    brier: brier / n,
  };
}

export function formatSummary(label: string, s: MetricSummary): string {
  const ev =
    s.expectedPointsPerMatch === null ? "  —  " : s.expectedPointsPerMatch.toFixed(3).padStart(5);
  return (
    `${label.padEnd(22)} n=${String(s.n).padStart(5)}  ` +
    `Tendenz ${(s.tendencyAccuracy * 100).toFixed(1).padStart(4)}%  ` +
    `Exakt ${(s.exactScoreRate * 100).toFixed(1).padStart(4)}%  ` +
    `Pkt/Spiel ${s.pointsPerMatch.toFixed(3).padStart(5)} (EV ${ev})  ` +
    `RPS ${s.rps.toFixed(4)}  LogLoss ${s.logLoss.toFixed(4)}  Brier ${s.brier.toFixed(4)}`
  );
}
