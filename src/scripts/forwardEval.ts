// Wertet das Vorwaerts-Log gegen die tatsaechlichen Ergebnisse aus.
//
//   npm run forward-eval
//   npm run forward-eval -- --pool      (ueber Konfigurationsaenderungen hinweg mitteln)
//
// Vorher "npm run refresh" laufen lassen, damit die Ergebnisse in den CSVs stehen.
//
// Die Ergebnisse werden hier zur Laufzeit dazugejoint, nicht im Log gespeichert -- das
// Log bleibt append-only und unveraenderlich, und damit ist es als Evidenz brauchbar.

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { loadAllMatches, parseMatchDate } from "../data/loadMatches";
import { formatSummary, outcomeOf, summarize, type PerMatchMetrics } from "../eval/metrics";
import { rankedProbabilityScore, logLoss, brierScore, argmaxOutcome } from "../eval/metrics";
import { formatBootstrap, formatMcNemar, mcnemarExact, pairedBootstrap } from "../eval/significance";
import { pointsFor, resolveScheme } from "../eval/scoringScheme";

const LOG_PATH = join(process.cwd(), "data", "forward_log.jsonl");

interface Variant {
  tip: string;
  expectedPoints: number;
  probs: { homeWinProb: number; drawProb: number; awayWinProb: number };
  constraints: string[];
}

interface LogEntry {
  season: string;
  matchday: number;
  homeTeam: string;
  awayTeam: string;
  kickoff: string;
  configHash: string;
  scheme: string;
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

// Ergebnisse dazujoinen.
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

for (const group of groups) {
  const scheme = resolveScheme(group.entries[0].scheme);

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

  console.log(`\n=== Konfiguration ${group.hash}, Schema "${scheme.label}" ===`);
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
      const [tipHome, tipAway] = variant.tip.split(":").map(Number);
      const actual = outcomeOf(s.homeGoals, s.awayGoals);
      rows.push({
        predicted: argmaxOutcome(variant.probs),
        actual,
        exactHit: tipHome === s.homeGoals && tipAway === s.awayGoals,
        points: pointsFor(tipHome, tipAway, s.homeGoals, s.awayGoals, scheme),
        expectedPoints: variant.expectedPoints,
        rps: rankedProbabilityScore(variant.probs, actual),
        logLoss: logLoss(variant.probs, actual),
        brier: brierScore(variant.probs, actual),
      });
    }
    perVariant.set(name, rows);
    console.log(formatSummary(name, summarize(rows)));
  }

  // Gepaarte Vergleiche gegen den Ausgangszustand.
  const baseline = "legacyArgmax";
  if (perVariant.has(baseline)) {
    console.log(`\nGepaart gegen "${baseline}" (positiv = Variante besser):`);
    const baseRows = perVariant.get(baseline)!;

    for (const name of variantNames) {
      if (name === baseline) continue;
      const rows = perVariant.get(name)!;
      if (rows.length !== baseRows.length) continue;

      let onlyA = 0;
      let onlyB = 0;
      const pointsDiffs: number[] = [];
      for (let i = 0; i < rows.length; i++) {
        const aRight = rows[i].predicted === rows[i].actual;
        const bRight = baseRows[i].predicted === baseRows[i].actual;
        if (aRight && !bRight) onlyA++;
        else if (!aRight && bRight) onlyB++;
        pointsDiffs.push(rows[i].points - baseRows[i].points);
      }

      console.log(`  ${name}`);
      console.log(`    ${formatMcNemar("Tendenz", mcnemarExact(onlyA, onlyB))}`);
      console.log(`    ${formatBootstrap("Punkte/Spiel", pairedBootstrap(pointsDiffs))}`);
    }
  }

  // Wie viel Evidenz braucht es ueberhaupt? Diese Zahl neben dem aktuellen n zu drucken
  // verhindert, dass ein frueher, zufaellig positiver Zwischenstand ueberinterpretiert wird.
  const fullRows = perVariant.get("full");
  const baseRows = perVariant.get(baseline);
  if (fullRows && baseRows && fullRows.length === baseRows.length && fullRows.length > 1) {
    const diffs = fullRows.map((r, i) => r.points - baseRows[i].points);
    const mean = diffs.reduce((s, d) => s + d, 0) / diffs.length;
    const sd = Math.sqrt(
      diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / Math.max(1, diffs.length - 1)
    );
    const target = 0.3; // im Backtest gemessener Effekt
    const needed = sd > 0 ? Math.ceil((1.96 * sd / target) ** 2) : 0;
    console.log(
      `\nStreuung der Punktedifferenz: ${sd.toFixed(2)}. Um einen Effekt von ${target} Punkten/Spiel\n` +
        `mit 95% Sicherheit von Null zu trennen, braucht es rund ${needed} Spiele ` +
        `(${(needed / 306).toFixed(1)} Saisons).\n` +
        `Aktuell ausgewertet: ${fullRows.length}.`
    );
  }
}
