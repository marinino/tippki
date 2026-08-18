// Wertet das Vorwaerts-Log gegen die tatsaechlichen Ergebnisse aus.
//
//   npm run forward-eval
//   npm run forward-eval -- --pool      (ueber Konfigurationsaenderungen hinweg mitteln)
//
// Vorher "npm run refresh" laufen lassen, damit die Ergebnisse in den CSVs stehen.
//
// Die Ergebnisse werden hier zur Laufzeit dazugejoint, nicht im Log gespeichert -- das
// Log bleibt append-only und unveraenderlich, und damit ist es als Evidenz brauchbar.
//
// Ausgewertet werden dieselben Maerkte wie im Backtest: 1X2, Over/Under 2.5 und das
// exakte Ergebnis. Die Frage ist immer dieselbe -- bringt der recherchierte Spielkontext
// prospektiv etwas, oder nicht?

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { loadAllMatches } from "../data/loadMatches";
import {
  argmaxOutcome,
  binaryBrier,
  binaryLogLoss,
  brierScore,
  formatSummary,
  logLoss,
  outcomeOf,
  rankedProbabilityScore,
  scoreLogLoss,
  summarize,
  type OutcomeProbs,
  type PerMatchMetrics,
} from "../eval/metrics";
import { formatBootstrap, formatMcNemar, mcnemarExact, pairedBootstrap } from "../eval/significance";

const LOG_PATH = join(process.cwd(), "data", "forward_log.jsonl");

interface Variant {
  probs: OutcomeProbs;
  over25: number | null;
  topScores: { score: string; prob: number }[];
}

interface LogEntry {
  season: string;
  matchday: number;
  homeTeam: string;
  awayTeam: string;
  kickoff: string;
  configHash: string;
  variants: Record<string, Variant>;
}

if (!existsSync(LOG_PATH)) {
  console.log("Noch kein Vorwaerts-Log vorhanden. Zuerst `npm run forward-log` laufen lassen.");
  process.exit(0);
}

const pool = process.argv.includes("--pool");

const entries: LogEntry[] = [];
for (const line of readFileSync(LOG_PATH, "utf-8").split("\n")) {
  if (!line.trim()) continue;
  try {
    entries.push(JSON.parse(line));
  } catch {
    console.warn("Unlesbare Logzeile uebersprungen.");
  }
}

if (entries.length === 0) {
  console.log("Log ist leer.");
  process.exit(0);
}

const results = new Map<string, { homeGoals: number; awayGoals: number }>();
for (const m of loadAllMatches()) {
  results.set(`${m.season}|${m.homeTeam}|${m.awayTeam}`, {
    homeGoals: m.homeGoals,
    awayGoals: m.awayGoals,
  });
}

const configs = [...new Set(entries.map((e) => e.configHash))];
if (configs.length > 1 && !pool) {
  console.log(
    `Das Log enthaelt ${configs.length} verschiedene Konfigurationen: ${configs.join(", ")}.\n` +
      `Ueber sie hinweg zu mitteln vermischt zwei Populationen und liefert eine Zahl, die\n` +
      `nichts bedeutet. Ausgewertet wird deshalb jede Konfiguration getrennt.\n` +
      `Mit --pool laesst sich das ueberstimmen.\n`
  );
}

const groups = pool
  ? [{ hash: "alle (gepoolt)", entries }]
  : configs.map((hash) => ({ hash, entries: entries.filter((e) => e.configHash === hash) }));

// Aus den zehn geloggten Spitzenergebnissen. Steht das tatsaechliche Ergebnis nicht
// darunter, ist seine Wahrscheinlichkeit unbekannt und die Zeile traegt zum
// Correct-Score-Vergleich nichts bei -- lieber eine Luecke als eine erfundene Zahl.
function scoreProbOf(variant: Variant, homeGoals: number, awayGoals: number): number | null {
  const hit = variant.topScores?.find((s) => s.score === `${homeGoals}:${awayGoals}`);
  return hit ? hit.prob : null;
}

for (const group of groups) {
  const settled: { entry: LogEntry; homeGoals: number; awayGoals: number }[] = [];
  let pending = 0;
  for (const entry of group.entries) {
    const result = results.get(`${entry.season}|${entry.homeTeam}|${entry.awayTeam}`);
    if (!result) {
      pending++;
      continue;
    }
    settled.push({ entry, ...result });
  }

  console.log(`\n=== Konfiguration ${group.hash} ===`);
  console.log(
    `${group.entries.length} protokollierte Spiele, davon ${settled.length} ausgewertet, ` +
      `${pending} noch offen.`
  );

  if (settled.length === 0) {
    console.log("Noch keine Ergebnisse -- nichts auszuwerten.");
    continue;
  }

  const matchdays = [...new Set(settled.map((s) => s.entry.matchday))].sort((a, b) => a - b);
  console.log(`Spieltage: ${matchdays.join(", ")}\n`);

  const variantNames = [...new Set(settled.flatMap((s) => Object.keys(s.entry.variants)))];
  const perVariant = new Map<string, PerMatchMetrics[]>();

  for (const name of variantNames) {
    const rows: PerMatchMetrics[] = [];
    for (const s of settled) {
      const variant = s.entry.variants[name];
      if (!variant) continue;
      const actual = outcomeOf(s.homeGoals, s.awayGoals);
      const overHappened = s.homeGoals + s.awayGoals > 2.5;
      const cellProb = scoreProbOf(variant, s.homeGoals, s.awayGoals);

      rows.push({
        predicted: argmaxOutcome(variant.probs),
        actual,
        rps: rankedProbabilityScore(variant.probs, actual),
        logLoss: logLoss(variant.probs, actual),
        brier: brierScore(variant.probs, actual),
        totals:
          variant.over25 === null
            ? null
            : {
                logLoss: binaryLogLoss(variant.over25, overHappened),
                brier: binaryBrier(variant.over25, overHappened),
              },
        handicap: null,
        scoreLogLoss: cellProb === null ? null : scoreLogLoss(cellProb),
      });
    }
    perVariant.set(name, rows);
    console.log(formatSummary(name, summarize(rows)));
  }

  // Der eigentliche Zweck des Logs: bringt der Spielkontext etwas?
  const baseline = "model";
  const treatment = "withLlm";
  const baseRows = perVariant.get(baseline);
  const llmRows = perVariant.get(treatment);

  if (baseRows && llmRows && baseRows.length === llmRows.length && baseRows.length > 0) {
    let onlyA = 0;
    let onlyB = 0;
    const rpsDiffs: number[] = [];
    const differing: number[] = [];

    for (let i = 0; i < llmRows.length; i++) {
      const aRight = llmRows[i].predicted === llmRows[i].actual;
      const bRight = baseRows[i].predicted === baseRows[i].actual;
      if (aRight && !bRight) onlyA++;
      else if (!aRight && bRight) onlyB++;
      const d = baseRows[i].rps - llmRows[i].rps;
      rpsDiffs.push(d);
      if (Math.abs(d) > 1e-9) differing.push(d);
    }

    console.log(`\nSpielkontext gegen Basismodell (positiv = Kontext besser):`);
    console.log(`  ${formatMcNemar("Tendenz", mcnemarExact(onlyA, onlyB))}`);
    console.log(`  ${formatBootstrap("RPS", pairedBootstrap(rpsDiffs))}`);
    console.log(
      `  Der Kontext hat auf ${differing.length} von ${rpsDiffs.length} Spielen ueberhaupt\n` +
        `  etwas veraendert. Auf den uebrigen ist die Differenz exakt 0 und sie verduennen\n` +
        `  den Mittelwert -- deshalb steht die Zahl hier daneben.`
    );

    // Wie viel Evidenz braucht es ueberhaupt? Diese Zahl neben dem aktuellen n zu drucken
    // verhindert, dass ein frueher, zufaellig positiver Zwischenstand ueberinterpretiert
    // wird.
    if (rpsDiffs.length > 1) {
      const mean = rpsDiffs.reduce((s, d) => s + d, 0) / rpsDiffs.length;
      const sd = Math.sqrt(
        rpsDiffs.reduce((s, d) => s + (d - mean) ** 2, 0) / Math.max(1, rpsDiffs.length - 1)
      );
      const target = 0.005; // ein Effekt in der Groessenordnung, die den Marktabstand schliessen wuerde
      const needed = sd > 0 ? Math.ceil(((1.96 * sd) / target) ** 2) : 0;
      console.log(
        `\n  Streuung der RPS-Differenz: ${sd.toFixed(4)}. Um einen Effekt von ${target} RPS mit\n` +
          `  95% Sicherheit von Null zu trennen, braucht es rund ${needed} Spiele ` +
          `(${(needed / 306).toFixed(1)} Saisons).\n` +
          `  Aktuell ausgewertet: ${rpsDiffs.length}.`
      );
    }
  }
}
