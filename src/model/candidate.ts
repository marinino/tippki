// Der Kandidat fuer die Saison 2027/28, festgeschrieben am 2026-11-19.
//
// Produktiv rechnet weiter die eingefrorene Pipeline (configHash 3cc0ddad, SAISONBETRIEB.md).
// Diese Datei beschreibt die EINE Alternative, die im Sommer 2027 gegen sie antritt: einmal,
// auf Spielen, die beim Festschreiben noch niemand gesehen hat (MESSLAUF.md, "Messplan 2").
//
// Festschreiben heisst: an dieser Datei aendert sich nichts mehr. selfCheck haelt einen
// Abdruck ihres Verhaltens fest (CANDIDATE_FINGERPRINT) und schlaegt bei jeder Aenderung an.
// Wer etwas aendern will, schreibt einen neuen Kandidaten mit neuem Messplan. Nachbessern am
// festgeschriebenen wuerde genau die Spiele verbrennen, auf denen er sich beweisen soll.
//
// Drei Aenderungen gegenueber der Produktion, jede mit einem Mechanismus statt nur einer Zahl:
//
// 1. Fit auf 50 % Tore und 50 % xG (target "blend", sonst wie produktiv: 500 Tage, Ridge 8).
//    xG ist dasselbe Mass mit weniger Rauschen. Im August an der Saisongrenze in allen
//    Konfigurationen leicht positiv, am 2026-11-19 walk-forward auf Validation bestaetigt:
//    1X2-LogLoss +0,0032 (p 0,01), RPS +0,0007 (p 0,05).
//
// 2. Die Form verschiebt nur das Kraefteverhaeltnis, die Summe der Torerwartungen bleibt.
//    Produktiv multipliziert sie die EIGENE Torerwartung mit exp(0,2 * Form). Die Form ist
//    aber ein Differenzsignal (xG − xGA), und sie traegt nachweislich keine Information ueber
//    die Toranzahl: in den Top-5-Ligen sagt das Tempo der letzten Spiele keine Tore voraus,
//    ueber das Kraefteverhaeltnis dagegen sehr wohl (Torschuss- und xG-Form +0,05 bis +0,06
//    je Standardabweichung ueber das Modell hinaus, RECHERCHE.md Abschnitt 4). Hier wirkt sie
//    deshalb nur auf log(λHeim / λGast), um genau denselben Betrag wie produktiv, und
//    λHeim + λGast bleibt stehen. Nebenwirkung: keine Torerwartung kann die Basis-Summe
//    ueberschreiten, die Dixon-Coles-Grenze aus VERBESSERUNGEN.md Punkt 20 ist ausser
//    Reichweite.
//
// 3. Kalibrierung: Temperatur zur Grundrate der Trainingsspiele statt zur Gleichverteilung
//    (applyOutcomeTemperatureTowards in scoreMatrix.ts). Die produktive Temperatur zieht jede
//    Vorhersage zu einem Drittel je Ausgang und nimmt dem Heimsieg dadurch im Schnitt 1,5
//    Prozentpunkte. T selbst auf Validation gescannt, fuer genau diese Kombination, Regel vor
//    dem Lauf: kleinster 1X2-LogLoss im Gitter (`npm run kandidat -- --temperatur-scan`).
//
// NICHT geaendert: ρ bleibt bei −0,15. Ueber fuenf Ligen gerechnet ist −0,05 besser (Remis
// und 0:0 werden mit −0,15 ueberschaetzt, RECHERCHE.md Abschnitt 2). Je Liga gerechnet traegt
// das aber nur ausserhalb der Bundesliga: Premier League, La Liga, Serie A und Ligue 1 wollen
// −0,05 (+0,003 bis +0,004 LogLoss exaktes Ergebnis), die Bundesliga will −0,15 (−0,0021 fuer
// −0,05, n.s.). Grund: 1:0 und 0:1 sind in der Bundesliga viel seltener (12,0 % gegen 16 bis
// 19 %), und genau die drueckt ρ = −0,15 richtig nach unten. Die Kontrolle auf der
// Bundesliga-Validation, im Kandidaten gerechnet, sagt dasselbe. Das ueberschaetzte 0:0 bleibt
// damit ein offener Punkt fuer einen spaeteren Kandidaten (VERBESSERUNGEN.md, Punkt 22).
//
// Alles andere bleibt wie produktiv: ρ = −0,15, xG-Form der letzten bis zu 3 Spiele dieser
// Saison (computeXgForm), maxGoals 10, kein Draw-Boost. Der LLM-Layer gehoert NICHT zum Kandidaten --
// er laesst sich nicht backtesten und wird im Vorwaerts-Log getrennt bewertet.
//
// Alle Werte stehen hier als Literale und sind nicht aus den produktiven Konstanten abgeleitet.
// Sonst wanderte der Kandidat mit, sobald zur naechsten Saison an der Produktion gedreht wird.

import type { OutcomeProbs } from "../eval/metrics";
import type { LeagueModelOptions } from "./teamStrength";
import {
  applyOutcomeTemperatureTowards,
  buildDixonColesMatrix,
  expectedGoals,
  outcomeMasses,
  scoreProb,
  type ScoreMatrix,
} from "./scoreMatrix";
import { fnv1a } from "./fnv1a";

export interface CandidateConfig {
  name: string;
  // Erster Anpfiff, der fuer die Bestaetigung zaehlt: alle Spiele der Saison 2026/27 ab
  // diesem Kalendertag. Der Commit, der diese Datei einfuehrt, muss VOR diesem Zeitpunkt
  // liegen -- `npm run kandidat -- --bestaetigung` prueft das gegen git und verweigert sonst.
  firstEvaluatedKickoff: string;
  // Fit
  halfLifeDays: number;
  ridgePseudoMatches: number;
  fitTarget: "blend";
  // Anteil der ECHTEN Tore am Fit-Ziel (der Rest ist xG), wie xgBlendWeight in teamStrength.ts.
  xgBlendWeight: number;
  // Form: Gewicht auf log(λHeim / λGast) je Einheit Formunterschied, Summe fest.
  formWeight: number;
  // Matrix und Kalibrierung
  rho: number;
  outcomeTemperature: number;
}

export const CANDIDATE_2027: CandidateConfig = {
  name: "kandidat-2027",
  firstEvaluatedKickoff: "2026-11-20T20:30:00+01:00",
  halfLifeDays: 500,
  ridgePseudoMatches: 8,
  fitTarget: "blend",
  xgBlendWeight: 0.5,
  formWeight: 0.2,
  rho: -0.15,
  // Gescannt am 2026-11-19 auf Validation (1224 Spiele mit Marktmittel-Schlusskurs), Regel
  // kleinster 1X2-LogLoss: 1,00 0,9932 | 1,10 0,9906 | 1,15 0,9899 | 1,20 0,9896 | 1,25 0,9895 |
  // 1,30 0,9897 | 1,40 0,9904 | 1,50 0,9916. Innen im Gitter, im flachen Stueck 1,15 bis 1,30.
  outcomeTemperature: 1.25,
};

export function candidateModelOptions(config: CandidateConfig = CANDIDATE_2027): LeagueModelOptions {
  return {
    halfLifeDays: config.halfLifeDays,
    ridgePseudoMatches: config.ridgePseudoMatches,
    target: config.fitTarget,
    xgBlendWeight: config.xgBlendWeight,
  };
}

// Die Form als reines Differenzsignal: log(λHeim / λGast) verschiebt sich um
// weight * (Form Heim − Form Gast), die Summe λHeim + λGast bleibt. Das ist auf dem
// log-Verhaeltnis exakt dieselbe Verschiebung wie produktiv (dort 0,2 * Form auf jede Seite
// einzeln), nur ohne die Torsumme mitzuziehen.
export function ratioFormLambdas(
  lambdaHome: number,
  lambdaAway: number,
  homeForm: number,
  awayForm: number,
  weight: number
): [number, number] {
  const sum = lambdaHome + lambdaAway;
  const logRatio = Math.log(lambdaHome / lambdaAway) + weight * (homeForm - awayForm);
  // Logistische Form statt e^r / (1 + e^r): bleibt auch bei extremem Verhaeltnis endlich.
  const homeShare = 1 / (1 + Math.exp(-logRatio));
  return [sum * homeShare, sum * (1 - homeShare)];
}

// 1X2-Grundrate einer Spielmenge, der Bezug der Kandidaten-Temperatur. Dieselbe Rechnung wie
// baseRatesOf in backtestCore.ts (ungeglaettete Anteile) -- selfCheck prueft das, damit der
// Bezug im Backtest und im spaeteren Echtbetrieb derselbe ist. Gemeint sind alle Spiele VOR
// der Saison, fuer die vorhergesagt wird.
export function outcomeBaseRate(matches: { homeGoals: number; awayGoals: number }[]): OutcomeProbs {
  const n = matches.length;
  if (n === 0) return { homeWinProb: 1 / 3, drawProb: 1 / 3, awayWinProb: 1 / 3 };
  let home = 0;
  let draw = 0;
  for (const m of matches) {
    if (m.homeGoals > m.awayGoals) home++;
    else if (m.homeGoals === m.awayGoals) draw++;
  }
  return { homeWinProb: home / n, drawProb: draw / n, awayWinProb: (n - home - draw) / n };
}

// Die Ergebnismatrix des Kandidaten aus den Basis-Torerwartungen seines Fits (target "blend")
// und der rohen xG-Form. Dieselben Schritte wie der Backtest mit candidateRunSpec().
export function candidateMatrix(
  lambdaHome: number,
  lambdaAway: number,
  homeForm: number,
  awayForm: number,
  baseRate: OutcomeProbs,
  config: CandidateConfig = CANDIDATE_2027
): ScoreMatrix {
  const [lh, la] = ratioFormLambdas(lambdaHome, lambdaAway, homeForm, awayForm, config.formWeight);
  const matrix = buildDixonColesMatrix(lh, la, { rho: config.rho });
  applyOutcomeTemperatureTowards(matrix, config.outcomeTemperature, baseRate);
  return matrix;
}

// Abdruck von Konfiguration UND Verhalten, nach dem Muster von llmMappingFingerprint: die
// Matrix wird auf festen Eingaben gerechnet, und das Ergebnis geht in den Hash. Damit faellt
// jede Aenderung auf, an einer Zahl hier oben ebenso wie an ratioFormLambdas, am ρ-Pfad von
// buildDixonColesMatrix oder an der Temperatur -- ohne dass jemand daran denken muss.
// Auf 10 Nachkommastellen gerundet, damit Rundungsrauschen der letzten Stelle nicht zaehlt.
export function candidateFingerprint(config: CandidateConfig = CANDIDATE_2027): string {
  const baseRate: OutcomeProbs = { homeWinProb: 0.45, drawProb: 0.245, awayWinProb: 0.305 };
  const samples: string[] = [JSON.stringify(config)];
  for (const [lh, la] of [
    [2.1, 0.9],
    [1.7, 1.1],
    [1.35, 1.35],
    [0.8, 2.2],
    [3.6, 0.7],
  ]) {
    for (const [fh, fa] of [
      [0, 0],
      [1.5, -0.5],
      [-1, 2.5],
    ]) {
      const m = candidateMatrix(lh, la, fh, fa, baseRate, config);
      const p = outcomeMasses(m);
      const e = expectedGoals(m);
      samples.push(
        [p.homeWinProb, p.drawProb, p.awayWinProb, scoreProb(m, 0, 0), scoreProb(m, 2, 1), e.home, e.away]
          .map((x) => x.toFixed(10))
          .join("|")
      );
    }
  }
  return fnv1a(samples.join(","));
}

// Der festgeschriebene Abdruck. selfCheck verlangt, dass candidateFingerprint() ihn trifft.
// NIE nachziehen, um eine Aenderung "einzupflegen" -- eine Aenderung ist ein neuer Kandidat.
export const CANDIDATE_FINGERPRINT = "f89c6088";
