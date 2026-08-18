// Buchmacherquoten -- ausschliesslich als MASSSTAB, niemals als Eingabe.
//
// Diese Datei liegt bewusst unter src/eval/ und nicht unter src/model/. Nichts in
// src/model/ darf sie importieren; wer das tut, hat das Ziel des Projekts aufgehoben.
// Das Modell soll den Buchmacher schlagen, also darf es ihn nicht abschreiben.
//
// Warum der Buchmacher ueberhaupt der Massstab ist: eine absolute Zahl wie "RPS 0.204"
// bedeutet fuer sich genommen nichts. Fussball ist zu einem grossen Teil Zufall, und wie
// viel davon prinzipiell erklaerbar ist, weiss niemand. Was man weiss: der Markt ist die
// schaerfste oeffentlich verfuegbare Schaetzung. Der Abstand zu ihm ist deshalb die
// einzige Zahl, die sagt, wo dieses Modell wirklich steht.
//
// WELCHE Quote. Bevorzugt wird die SCHLUSSQUOTE von Pinnacle (PSCH/PSCD/PSCA):
//   - Pinnacle nimmt sehr hohe Einsaetze an und korrigiert danach die Linie, statt
//     Gewinner auszuschliessen. Die Quote enthaelt deshalb die Meinung derer, die genug
//     Vertrauen in ihre Schaetzung haben, um viel Geld darauf zu setzen.
//   - Der Overround liegt bei rund 2 bis 3 Prozent -- ein Bruchteil dessen, was ein
//     Freizeit-Buchmacher nimmt. Je kleiner die Marge, desto weniger verzerrt das
//     Entvigen das Ergebnis.
// Das ist die haerteste verfuegbare Messlatte. Eine weichere waere Selbstbetrug.
//
// EINE LUECKE, und sie ist wichtig: football-data.co.uk fuehrt Pinnacle in der Saison
// 2025/26 nur noch fuer 149 der 306 Spiele -- die Spalte bricht zur Winterpause ab. Diese
// Saison gehoert zum Testset, dort halbiert sich also die Fallzahl. Sie wird deshalb
// nicht stillschweigend aufgefuellt: `requireBenchmark` in backtestCore.ts wirft die
// Spiele ohne Referenz aus ALLEN Varianten heraus, und der Backtest berichtet, wie viele
// das waren. Wer die volle Saison braucht, nimmt ausdruecklich "marketAverageClose" --
// das kostet Schaerfe, aber die Zahl weiss dann wenigstens, worauf sie beruht.
//
// WANN die Quote steht: die Schlussquote ist die Linie zum Anpfiff. Sie kennt
// Aufstellungen, Ausfaelle und den gesamten Geldfluss des Spieltags. Das Modell kennt
// das nicht (der LLM-Layer versucht einen Teil davon). Der Vergleich ist also bewusst
// unfair zu unseren Gunsten falsch herum -- wir messen uns an der bestinformierten
// Version des Gegners, nicht an der leichtesten.

import type { Match } from "../data/loadMatches";
import type { OutcomeProbs } from "./metrics";

// Proportionales Entvigen: jede Roh-Wahrscheinlichkeit durch die Summe teilen.
//
// Bekannte Schwaeche, der Ehrlichkeit halber: der Aufschlag ist in Wirklichkeit nicht
// gleichmaessig ueber die Ausgaenge verteilt -- Buchmacher belasten Aussenseiter
// staerker (Favourite-Longshot-Bias). Proportional zu teilen unterschaetzt deshalb
// Favoriten leicht. Bei den 2 bis 3 Prozent Overround der Pinnacle-Schlussquote ist der
// Effekt klein; bei den ~41 Prozent eines Correct-Score-Marktes waere er grob falsch,
// und deshalb wird dieser Markt hier gar nicht erst angefasst.
export function devigThreeWay(
  oddsHome: number,
  oddsDraw: number,
  oddsAway: number
): OutcomeProbs {
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

// Zweiwertig, fuer Halblinien (Over/Under x.5, Handicap x.5): dort gibt es kein Push,
// die beiden Seiten sind komplementaer.
export function devigTwoWay(oddsA: number, oddsB: number): number {
  const rawA = 1 / oddsA;
  const rawB = 1 / oddsB;
  return rawA / (rawA + rawB);
}

// Summe der Kehrwerte. 1.03 heisst 3 Prozent Marge. Wird berichtet, damit sichtbar
// bleibt, wie stark das proportionale Entvigen ueberhaupt eingreifen musste.
export function overroundOf(...odds: number[]): number {
  return odds.reduce((sum, o) => sum + 1 / o, 0);
}

export type BenchmarkSource = "pinnacleClose" | "marketAverageClose" | "marketAverageOpen";

export const BENCHMARK_LABELS: Record<BenchmarkSource, string> = {
  pinnacleClose: "Pinnacle Schlussquote",
  marketAverageClose: "Marktmittel Schluss",
  marketAverageOpen: "Marktmittel Eroeffnung",
};

export const DEFAULT_BENCHMARK: BenchmarkSource = "pinnacleClose";

export interface BenchmarkHandicap {
  // Aus Heimsicht, Buchmacherkonvention: -1.5 heisst "Heim gewinnt mit mindestens 2 Toren".
  line: number;
  homeCoverProb: number;
}

export interface BenchmarkQuote {
  source: BenchmarkSource;
  probs: OutcomeProbs;
  overround: number;
  // Entvigte Wahrscheinlichkeit fuer "mehr als 2.5 Tore", falls die Linie vorliegt.
  totalsOverProb: number | null;
  // Asian Handicap, nur bei Halblinien. Der einzige Markt in den historischen Daten, der
  // die TORDIFFERENZ bepreist -- 1X2 und Over/Under sagen dazu nichts, und genau dort
  // muss sich eine Verteilung beweisen, die mehr sein will als drei Zahlen.
  handicap: BenchmarkHandicap | null;
}

// Ganze Linien (-1.0) und Viertellinien (-1.25) sind nicht zweiwertig: die eine kennt ein
// Push, die andere teilt den Einsatz auf zwei Nachbarlinien auf. devigTwoWay waere dort
// falsch, also werden sie verworfen statt schief behandelt. Rund drei Viertel der
// historischen Linien fallen dadurch weg -- der Handicap-Vergleich laeuft entsprechend
// auf weniger Spielen, und die Auswertung berichtet das.
function halfLineHandicap(
  line: number | undefined,
  oddsHome: number | undefined,
  oddsAway: number | undefined
): BenchmarkHandicap | null {
  if (line === undefined || !oddsHome || !oddsAway) return null;
  if (Math.abs(line % 1) !== 0.5) return null;
  return { line, homeCoverProb: devigTwoWay(oddsHome, oddsAway) };
}

function quoteFrom(
  source: BenchmarkSource,
  home: number | undefined,
  draw: number | undefined,
  away: number | undefined,
  over: number | undefined,
  under: number | undefined,
  ahLine: number | undefined,
  ahHome: number | undefined,
  ahAway: number | undefined
): BenchmarkQuote | null {
  if (!home || !draw || !away) return null;
  return {
    source,
    probs: devigThreeWay(home, draw, away),
    overround: overroundOf(home, draw, away),
    totalsOverProb: over && under ? devigTwoWay(over, under) : null,
    handicap: halfLineHandicap(ahLine, ahHome, ahAway),
  };
}

// Die gewuenschte Quelle, sonst nichts. Bewusst KEIN stiller Rueckfall auf eine andere
// Quelle: sonst mischt eine Auswertung zwei verschieden scharfe Gegner in einer Zahl,
// und der Unterschied waere nicht mehr dem Modell zuzuordnen. Wer weniger Luecken will,
// waehlt ausdruecklich eine andere Quelle.
export function benchmarkQuote(
  match: Match,
  source: BenchmarkSource = DEFAULT_BENCHMARK
): BenchmarkQuote | null {
  if (source === "pinnacleClose") {
    return quoteFrom(
      source,
      match.closeOddsHome,
      match.closeOddsDraw,
      match.closeOddsAway,
      match.closeOddsOver25,
      match.closeOddsUnder25,
      match.closeAhLine,
      match.closeAhOddsHome,
      match.closeAhOddsAway
    );
  }
  if (source === "marketAverageClose") {
    return quoteFrom(
      source,
      match.avgCloseOddsHome,
      match.avgCloseOddsDraw,
      match.avgCloseOddsAway,
      match.avgCloseOddsOver25,
      match.avgCloseOddsUnder25,
      match.avgCloseAhLine,
      match.avgCloseAhOddsHome,
      match.avgCloseAhOddsAway
    );
  }
  return quoteFrom(
    source,
    match.openOddsHome,
    match.openOddsDraw,
    match.openOddsAway,
    match.openOddsOver25,
    match.openOddsUnder25,
    match.openAhLine,
    match.openAhOddsHome,
    match.openAhOddsAway
  );
}

export function parseBenchmarkSource(raw?: string | null): BenchmarkSource {
  if (raw === "marketAverageClose" || raw === "marketAverageOpen" || raw === "pinnacleClose") {
    return raw;
  }
  return DEFAULT_BENCHMARK;
}
