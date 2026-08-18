// Bewertungsmetriken.
//
// Zwei Zielgroessen sind hier bewusst verschwunden:
//
//   Tendenz-Trefferquote -- wirft die gesamte Wahrscheinlichkeitsinformation weg und ist
//   die verrauschteste verfuegbare Metrik (SE = 1.01 Prozentpunkte bei n = 2448).
//   Unterschiede von 0.2 bis 0.5 Punkten lassen sich damit grundsaetzlich nicht von
//   Zufall unterscheiden. Sie wird noch berichtet, nie mehr optimiert.
//
//   Tippspiel-Punkte -- die Zielgroesse eines Kicktipp-Wettbewerbs. Sie belohnt eine
//   Punktschaetzung ("2:1") und ist gegenueber der Verteilung dahinter weitgehend blind.
//   Ein Modell, das mit Buchmachern konkurrieren soll, wird an der Verteilung gemessen,
//   nicht an einer daraus abgeleiteten Einzelwette.
//
// Optimiert wird auf STRIKT PROPERE Bewertungsregeln: RPS auf 1X2, LogLoss auf jedem
// Markt. Strikt proper heisst, dass der erwartete Score genau dann minimal wird, wenn das
// Modell seine tatsaechliche Ueberzeugung angibt -- Schoenfaerben lohnt sich nicht. Genau
// das braucht man, wenn die Zahl selbst das Produkt ist.

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
// gewinnt also die spaetere Option. Willkuerlich, aber es zu aendern wuerde die
// historischen Vergleichszahlen verschieben -- also bleibt es so.
export function argmaxOutcome(p: OutcomeProbs): Outcome {
  if (p.homeWinProb > p.drawProb && p.homeWinProb > p.awayWinProb) return "H";
  if (p.drawProb > p.awayWinProb) return "D";
  return "A";
}

export function probOf(p: OutcomeProbs, outcome: Outcome): number {
  return outcome === "H" ? p.homeWinProb : outcome === "D" ? p.drawProb : p.awayWinProb;
}

// Ranked Probability Score fuer die drei GEORDNETEN Ausgaenge H < D < A.
// Anders als Brier oder LogLoss bestraft der RPS eine Fehlprognose danach, wie weit sie
// in der Ordnung danebenliegt: einen Heimsieg als Unentschieden vorherzusagen ist weniger
// falsch, als ihn als Auswaertssieg vorherzusagen. Standardmetrik fuer Fussball-1X2.
// 0 = perfekt, 1 = maximal falsch.
export function rankedProbabilityScore(p: OutcomeProbs, actual: Outcome): number {
  const c1 = p.homeWinProb;
  const c2 = p.homeWinProb + p.drawProb;
  const a1 = actual === "H" ? 1 : 0;
  const a2 = actual === "A" ? 0 : 1;
  return ((c1 - a1) ** 2 + (c2 - a2) ** 2) / 2;
}

const LOG_LOSS_FLOOR = 1e-15;

// -ln p(tatsaechlicher Ausgang). Bestraft Ueberzeugung sehr hart und ist damit der
// empfindlichste Kalibrierungsindikator.
export function logLoss(p: OutcomeProbs, actual: Outcome): number {
  return -Math.log(Math.max(probOf(p, actual), LOG_LOSS_FLOOR));
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

// Zweiwertige Maerkte (Over/Under, BTTS, Handicap): dieselben Regeln, eine Dimension.
export function binaryLogLoss(prob: number, happened: boolean): number {
  const p = happened ? prob : 1 - prob;
  return -Math.log(Math.max(p, LOG_LOSS_FLOOR));
}

export function binaryBrier(prob: number, happened: boolean): number {
  return (prob - (happened ? 1 : 0)) ** 2;
}

// Der schaerfste Test der Verteilung: -ln P(exaktes Ergebnis) ueber die volle Matrix.
// RPS und LogLoss auf 1X2 sehen nur drei aggregierte Massen und sind blind fuer alles,
// was Masse INNERHALB einer Tendenz verschiebt -- also fuer genau die Frage, ob ein
// Heimsieg eher 1:0 oder 3:1 ausfaellt. Correct-Score-LogLoss sieht das.
export function scoreLogLoss(prob: number): number {
  return -Math.log(Math.max(prob, LOG_LOSS_FLOOR));
}

export interface BinaryScores {
  logLoss: number;
  brier: number;
}

export interface PerMatchMetrics {
  predicted: Outcome;
  actual: Outcome;
  rps: number;
  logLoss: number;
  brier: number;
  // Markt "mehr als 2.5 Tore". null, wenn die Variante ihn nicht bepreist oder der
  // Buchmacher die Linie in dieser Saison nicht gestellt hat.
  totals: BinaryScores | null;
  // Asian Handicap auf der vom Buchmacher gestellten Halblinie. Der Markt der
  // Tordifferenz -- er faellt weg, sobald keine Halblinie vorliegt.
  handicap: BinaryScores | null;
  // -ln P(exaktes Ergebnis) aus der vollen Matrix. null bei Varianten ohne Matrix.
  scoreLogLoss: number | null;
}

export interface MetricSummary {
  n: number;
  tendencyAccuracy: number;
  rps: number;
  logLoss: number;
  brier: number;
  // Jeder Zusatzmarkt bringt seine eigene Fallzahl mit. Ohne die waere nicht erkennbar,
  // dass eine Zahl auf einem Viertel der Spiele beruht.
  totalsN: number;
  totalsLogLoss: number;
  totalsBrier: number;
  handicapN: number;
  handicapLogLoss: number;
  handicapBrier: number;
  scoreN: number;
  scoreLogLoss: number;
}

const EMPTY_SUMMARY: MetricSummary = {
  n: 0,
  tendencyAccuracy: 0,
  rps: 0,
  logLoss: 0,
  brier: 0,
  totalsN: 0,
  totalsLogLoss: 0,
  totalsBrier: 0,
  handicapN: 0,
  handicapLogLoss: 0,
  handicapBrier: 0,
  scoreN: 0,
  scoreLogLoss: 0,
};

export function summarize(rows: PerMatchMetrics[]): MetricSummary {
  const n = rows.length;
  if (n === 0) return { ...EMPTY_SUMMARY };

  let correct = 0;
  let rps = 0;
  let ll = 0;
  let brier = 0;
  let totalsN = 0;
  let totalsLl = 0;
  let totalsBr = 0;
  let handicapN = 0;
  let handicapLl = 0;
  let handicapBr = 0;
  let scoreN = 0;
  let scoreLl = 0;

  for (const r of rows) {
    if (r.predicted === r.actual) correct++;
    rps += r.rps;
    ll += r.logLoss;
    brier += r.brier;
    if (r.totals) {
      totalsN++;
      totalsLl += r.totals.logLoss;
      totalsBr += r.totals.brier;
    }
    if (r.handicap) {
      handicapN++;
      handicapLl += r.handicap.logLoss;
      handicapBr += r.handicap.brier;
    }
    if (r.scoreLogLoss !== null) {
      scoreN++;
      scoreLl += r.scoreLogLoss;
    }
  }

  return {
    n,
    tendencyAccuracy: correct / n,
    rps: rps / n,
    logLoss: ll / n,
    brier: brier / n,
    totalsN,
    totalsLogLoss: totalsN > 0 ? totalsLl / totalsN : 0,
    totalsBrier: totalsN > 0 ? totalsBr / totalsN : 0,
    handicapN,
    handicapLogLoss: handicapN > 0 ? handicapLl / handicapN : 0,
    handicapBrier: handicapN > 0 ? handicapBr / handicapN : 0,
    scoreN,
    scoreLogLoss: scoreN > 0 ? scoreLl / scoreN : 0,
  };
}

function optional(value: number, n: number): string {
  return n > 0 ? value.toFixed(4) : "  —   ";
}

export function formatSummary(label: string, s: MetricSummary): string {
  return (
    `${label.padEnd(24)} n=${String(s.n).padStart(5)}  ` +
    `RPS ${s.rps.toFixed(4)}  LogLoss ${s.logLoss.toFixed(4)}  Brier ${s.brier.toFixed(4)}  ` +
    `O/U ${optional(s.totalsLogLoss, s.totalsN)}  ` +
    `AH ${optional(s.handicapLogLoss, s.handicapN)}  ` +
    `Score ${optional(s.scoreLogLoss, s.scoreN)}  ` +
    `Tendenz ${(s.tendencyAccuracy * 100).toFixed(1)}%`
  );
}
