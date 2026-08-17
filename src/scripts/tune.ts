// Hyperparametersuche -- ausschliesslich auf den Validation-Saisons.
//
//   npm run tune
//   npm run tune -- --split=validation
//
// Regeln, die hier eingebaut sind statt nur dokumentiert:
//
//   1. Zielgroesse ist RPS, nicht Trefferquote. Punkte/Spiel werden daneben berichtet.
//   2. Getunt wird NUR auf VALIDATION_SEASONS. Die Test-Saisons werden hier gar nicht
//      geladen -- sonst waere die spaeter berichtete Out-of-Sample-Zahl wertlos.
//   3. Jeder Kandidat wird gepaart gegen die Ausgangskonfiguration getestet. Eine
//      RPS-Verbesserung unter ACCEPT_THRESHOLD gilt als Rauschen und wird abgelehnt.
//
// Punkt 3 ist der Grund fuer diese Datei: bei hunderten Kandidaten auf 1530 Spielen ist
// der beste Wert konstruktionsbedingt zu optimistisch. Ohne Schwelle wuerde man
// zuverlaessig Rauschen einbauen und es fuer Fortschritt halten.

import { formatSummary, summarize } from "../eval/metrics";
import { pairedBootstrap } from "../eval/significance";
import { resolveScheme } from "../eval/scoringScheme";
import { parseSplit, seasonsFor, warnIfTestSplit, type SplitName } from "../eval/splits";
import {
  buildContexts,
  evaluateRun,
  toPerMatchMetrics,
  type RunSpec,
  type SeasonContexts,
} from "../eval/backtestCore";
import { SEASON_RECENCY_WEIGHTS, type LeagueModelOptions } from "../model/teamStrength";

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

// Unter dieser RPS-Verbesserung wird nichts uebernommen.
const ACCEPT_THRESHOLD = 0.002;

const split: SplitName = flag("split") ? parseSplit(flag("split")) : "validation";
const scheme = resolveScheme(flag("scheme"));

warnIfTestSplit(split);

const seasons = seasonsFor(split);
console.log(`Tuning auf "${split}" (${seasons.join(", ")}), Schema "${scheme.label}"`);
console.log(`Annahmeschwelle: ΔRPS > ${ACCEPT_THRESHOLD}\n`);

// Der Lauf, auf den alle Kandidaten gemessen werden: volle Pipeline, EV-Tipp,
// Markt-1X2 und Torsummen-Bedingung.
const RUN: RunSpec = {
  name: "voll",
  variant: "blended",
  tipMode: "ev",
  useTotals: true,
};

interface Candidate {
  label: string;
  model: LeagueModelOptions;
}

const candidates: Candidate[] = [];

// Ridge: der wichtigste neue Knopf. Bei den Ein-Saison-Fits hat jedes Team nur 34 Spiele,
// und Aufsteiger haben gar keine Historie -- ohne Shrinkage sind diese Schaetzungen laut.
for (const ridge of [0, 1, 2, 5, 10, 20, 40]) {
  candidates.push({ label: `ridge=${ridge}`, model: { ridgePseudoMatches: ridge } });
}

// Saisongewichte: aktuell sehr scharf (0.6 auf die letzte Saison). Ob das stimmt, wurde
// nie gemessen.
const weightProfiles: [string, number[]][] = [
  ["aktuell", SEASON_RECENCY_WEIGHTS],
  ["flacher", [0.4, 0.25, 0.15, 0.1, 0.06, 0.04]],
  ["schaerfer", [0.75, 0.2, 0.03, 0.01, 0.01, 0]],
  ["exp 0.5", [0.5, 0.25, 0.125, 0.0625, 0.0313, 0.0157]],
  ["gleich", [1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6]],
  ["nur letzte", [1, 0, 0, 0, 0, 0]],
];
for (const [label, weights] of weightProfiles) {
  candidates.push({ label: `gewichte=${label}`, model: { seasonRecencyWeights: weights } });
}

const baselineOptions: LeagueModelOptions = {};
const baselineContexts = buildContexts(seasons, baselineOptions);
const baselineEval = evaluateRun(baselineContexts, RUN, scheme);
const baselineSummary = summarize(baselineEval.map(toPerMatchMetrics));

console.log(formatSummary("AUSGANG", baselineSummary));
console.log("");

interface Scored {
  label: string;
  model: LeagueModelOptions;
  rps: number;
  points: number;
  deltaRps: number;
  pValue: number;
  ciLow: number;
  ciHigh: number;
  accepted: boolean;
}

function score(label: string, model: LeagueModelOptions, contexts: SeasonContexts[]): Scored {
  const evaluations = evaluateRun(contexts, RUN, scheme);
  const summary = summarize(evaluations.map(toPerMatchMetrics));

  // Gepaart: gleiche Spiele, gleiche Reihenfolge. Positiv = Kandidat besser.
  const rpsDiffs = evaluations.map((e, i) => baselineEval[i].rps - e.rps);
  const test = pairedBootstrap(rpsDiffs, { iterations: 4000 });

  return {
    label,
    model,
    rps: summary.rps,
    points: summary.pointsPerMatch,
    deltaRps: test.meanDiff,
    pValue: test.pValue,
    ciLow: test.ciLow,
    ciHigh: test.ciHigh,
    accepted: test.meanDiff > ACCEPT_THRESHOLD && test.pValue < 0.05,
  };
}

const results: Scored[] = [];
for (const candidate of candidates) {
  const contexts = buildContexts(seasons, candidate.model);
  results.push(score(candidate.label, candidate.model, contexts));
}

results.sort((a, b) => b.deltaRps - a.deltaRps);

console.log("Kandidat              RPS      Pkt/Spiel   ΔRPS       95% CI                p       ");
console.log("".padEnd(92, "-"));
for (const r of results) {
  const mark = r.accepted ? "✓" : r.deltaRps > 0 ? "·" : " ";
  console.log(
    `${mark} ${r.label.padEnd(20)} ${r.rps.toFixed(4)}  ${r.points.toFixed(3)}      ` +
      `${r.deltaRps >= 0 ? "+" : ""}${r.deltaRps.toFixed(4)}   ` +
      `[${r.ciLow >= 0 ? "+" : ""}${r.ciLow.toFixed(4)}, ${r.ciHigh >= 0 ? "+" : ""}${r.ciHigh.toFixed(4)}]   ` +
      `${r.pValue.toFixed(4)}`
  );
}

const accepted = results.filter((r) => r.accepted);
console.log(
  `\n${accepted.length} von ${results.length} Kandidaten ueberschreiten die Schwelle von ` +
    `${ACCEPT_THRESHOLD} RPS bei p < 0.05.`
);

if (accepted.length === 0) {
  console.log(
    "Nichts uebernommen. Das ist ein gueltiges Ergebnis, kein Fehlschlag -- die\n" +
      "Ausgangskonfiguration ist auf diesen Daten nicht nachweisbar zu schlagen."
  );
} else {
  const best = accepted[0];
  console.log(`\nBester Kandidat: ${best.label}`);
  console.log(`  ${JSON.stringify(best.model)}`);
  console.log(
    `  RPS ${baselineSummary.rps.toFixed(4)} -> ${best.rps.toFixed(4)}, ` +
      `Punkte/Spiel ${baselineSummary.pointsPerMatch.toFixed(3)} -> ${best.points.toFixed(3)}`
  );
  console.log(
    `\nAchtung: dieser Gewinner ist als Maximum ueber ${results.length} Kandidaten\n` +
      `optimistisch verzerrt. Der ehrliche Wert steht erst im Testset-Report.`
  );
}
