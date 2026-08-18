// Das Produkt dieses Projekts: ein vollstaendiges Preisblatt aus der Score-Matrix.
//
// Bis hierher war die Ausgabe ein einzelner Ergebnistipp, gewaehlt nach dem
// Punkte-Erwartungswert eines Tippspiels. Das ist eine andere Aufgabe als die hier
// gestellte. Ein Tippspiel belohnt eine Punktschaetzung; ein Buchmacher verkauft eine
// VERTEILUNG, und zwar auf jedem Markt gleichzeitig. Wer mit ihm konkurrieren will, muss
// dieselben Maerkte bepreisen und sich auf jedem einzeln messen lassen.
//
// Alles hier ist eine reine Umrechnung der Matrix -- es gibt keinen freien Parameter und
// keine zusaetzliche Annahme. Genau deshalb ist das Preisblatt auch ein scharfer Test:
// jede Schwaeche der Verteilung schlaegt auf mindestens einem Markt sichtbar durch, und
// eine Verbesserung, die nur 1X2 hilft und die Torsumme verschlechtert, faellt auf.
//
// Faire Quote heisst: OHNE Marge. Ein Buchmacher legt auf 1/p noch seinen Aufschlag,
// sodass die Kehrwerte seiner angebotenen Quoten auf mehr als 1 summieren. Die Zahlen
// hier summieren je Markt exakt auf 1. Das ist der Punkt -- verglichen werden soll die
// Schaetzung, nicht die Marge.

import {
  goalDifferenceMarginal,
  expectedGoals,
  outcomeMasses,
  scoreProb,
  totalGoalsMarginal,
  type ScoreMatrix,
} from "./scoreMatrix";

export interface Price {
  prob: number;
  // 1/prob. Bei prob = 0 nicht Infinity, sondern eine endliche Obergrenze -- eine
  // Quote von 1e6 ist als Anzeige lesbar, Infinity bricht jede Formatierung.
  fairOdds: number;
}

const MAX_FAIR_ODDS = 1e6;

export function priceOf(prob: number): Price {
  const clamped = Math.min(Math.max(prob, 0), 1);
  return { prob: clamped, fairOdds: clamped <= 1 / MAX_FAIR_ODDS ? MAX_FAIR_ODDS : 1 / clamped };
}

export interface TotalsLine {
  line: number;
  over: Price;
  under: Price;
}

export interface HandicapLine {
  // Aus Heimsicht, Buchmacherkonvention: -1.5 heisst "Heim gewinnt mit mindestens 2 Toren".
  line: number;
  home: Price;
  away: Price;
}

export interface CorrectScorePrice {
  score: string;
  homeGoals: number;
  awayGoals: number;
  price: Price;
}

export interface PriceSheet {
  outcome: { home: Price; draw: Price; away: Price };
  doubleChance: { homeOrDraw: Price; homeOrAway: Price; drawOrAway: Price };
  bothTeamsToScore: { yes: Price; no: Price };
  totals: TotalsLine[];
  handicaps: HandicapLine[];
  // Absteigend nach Wahrscheinlichkeit. Der Rest der Matrix steckt in `correctScoreOther`.
  correctScore: CorrectScorePrice[];
  correctScoreOther: Price;
  expectedGoals: { home: number; away: number; total: number };
}

// Nur Halblinien. Auf einer ganzen Linie (Total 3.0, Handicap -1.0) ist die Wette
// dreiwertig -- Over, Under und Push -- und ein zweispaltiges Preisblatt waere schlicht
// falsch. Buchmacher loesen das ueber Rueckzahlung; hier wird die Linie stattdessen gar
// nicht erst angeboten. Halblinien decken jede Frage ab, die uns interessiert.
export const DEFAULT_TOTALS_LINES = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5];
export const DEFAULT_HANDICAP_LINES = [-3.5, -2.5, -1.5, -0.5, 0.5, 1.5, 2.5, 3.5];

export interface PriceSheetOptions {
  totalsLines?: number[];
  handicapLines?: number[];
  correctScoreCount?: number;
}

const DEFAULT_CORRECT_SCORE_COUNT = 20;

export function buildPriceSheet(m: ScoreMatrix, options: PriceSheetOptions = {}): PriceSheet {
  const totalsLines = options.totalsLines ?? DEFAULT_TOTALS_LINES;
  const handicapLines = options.handicapLines ?? DEFAULT_HANDICAP_LINES;
  const scoreCount = options.correctScoreCount ?? DEFAULT_CORRECT_SCORE_COUNT;

  const masses = outcomeMasses(m);
  const totalMarginal = totalGoalsMarginal(m);
  const diffMarginal = goalDifferenceMarginal(m);
  const goals = expectedGoals(m);

  // Over-Wahrscheinlichkeit je Linie: Summe aller Torsummen echt oberhalb der Linie.
  const totals: TotalsLine[] = totalsLines.map((line) => {
    let over = 0;
    for (let k = Math.ceil(line); k < totalMarginal.length; k++) over += totalMarginal[k];
    return { line, over: priceOf(over), under: priceOf(1 - over) };
  });

  // Handicap-Linie l (Heimsicht) gewinnt Heim genau dann, wenn Differenz > -l ist.
  // Beispiel: l = -1.5 -> Differenz > 1.5 -> Differenz >= 2.
  const handicaps: HandicapLine[] = handicapLines.map((line) => {
    let home = 0;
    const from = Math.max(Math.ceil(-line), -m.maxGoals);
    for (let d = from; d <= m.maxGoals; d++) home += diffMarginal[d + m.maxGoals];
    return { line, home: priceOf(home), away: priceOf(1 - home) };
  });

  // BTTS: Gegenwahrscheinlichkeit zur Vereinigung "Heim trifft nicht" und "Ausw trifft
  // nicht". Ueber die Randzeile/-spalte gerechnet, damit die Dixon-Coles-Korrektur in den
  // niedrigen Zellen korrekt eingeht -- unter Unabhaengigkeitsannahme waere sie es nicht.
  let noHome = 0;
  let noAway = 0;
  for (let k = 0; k <= m.maxGoals; k++) {
    noHome += scoreProb(m, 0, k);
    noAway += scoreProb(m, k, 0);
  }
  const bothScore = 1 - noHome - noAway + scoreProb(m, 0, 0);

  const cells: CorrectScorePrice[] = [];
  for (let h = 0; h <= m.maxGoals; h++) {
    for (let a = 0; a <= m.maxGoals; a++) {
      cells.push({
        score: `${h}:${a}`,
        homeGoals: h,
        awayGoals: a,
        price: priceOf(scoreProb(m, h, a)),
      });
    }
  }
  cells.sort((x, y) => y.price.prob - x.price.prob);
  const correctScore = cells.slice(0, scoreCount);
  const listed = correctScore.reduce((sum, c) => sum + c.price.prob, 0);

  return {
    outcome: {
      home: priceOf(masses.homeWinProb),
      draw: priceOf(masses.drawProb),
      away: priceOf(masses.awayWinProb),
    },
    doubleChance: {
      homeOrDraw: priceOf(masses.homeWinProb + masses.drawProb),
      homeOrAway: priceOf(masses.homeWinProb + masses.awayWinProb),
      drawOrAway: priceOf(masses.drawProb + masses.awayWinProb),
    },
    bothTeamsToScore: { yes: priceOf(bothScore), no: priceOf(1 - bothScore) },
    totals,
    handicaps,
    correctScore,
    correctScoreOther: priceOf(Math.max(0, 1 - listed)),
    expectedGoals: { home: goals.home, away: goals.away, total: goals.home + goals.away },
  };
}

// Dezimalquote mit zwei Nachkommastellen, wie sie ein Buchmacher anschreibt.
export function formatOdds(price: Price): string {
  if (price.fairOdds >= 1000) return "999+";
  return price.fairOdds.toFixed(2);
}
