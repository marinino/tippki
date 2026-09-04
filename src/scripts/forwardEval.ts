// Wertet das Vorwaerts-Log gegen die tatsaechlichen Ergebnisse aus.
//
//   npm run forward-eval
//   npm run forward-eval -- --pool                            (ueber Konfigurationsaenderungen hinweg mitteln)
//   npm run forward-eval -- --benchmark=marketAverageClose    (anderer Gegner)
//   npm run forward-eval -- --matches                         (Quoten Spiel fuer Spiel erzwingen)
//
// Vorher "npm run refresh" und "npm run refresh-market" laufen lassen -- das erste bringt die
// Ergebnisse, das zweite die Schlussquoten der Buchmacher.
//
// Die Ergebnisse UND die Quoten werden hier zur Laufzeit dazugejoint, nicht im Log
// gespeichert -- das Log bleibt append-only und unveraenderlich, und genau das macht es als
// Evidenz brauchbar. Die eigene Vorhersage steht fest, bevor irgendetwas davon existiert.
//
// Zwei Fragen werden getrennt beantwortet:
//   1. Bringt der recherchierte Spielkontext etwas? (Modell gegen Modell+LLM)
//   2. Wo stehen wir gegen den Buchmacher? (beide Varianten gegen die Schlussquote)
// Frage 2 laeuft nur auf den Spielen, fuer die eine Referenzquote vorliegt -- alle Varianten
// auf derselben Spielmenge, sonst vergleicht die Zahl zwei verschiedene Stichproben.

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { loadAllMatches, type Match } from "../data/loadMatches";
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
import {
  BENCHMARK_LABELS,
  benchmarkQuote,
  parseBenchmarkSource,
  type BenchmarkQuote,
} from "../eval/benchmarkOdds";

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
  // null heisst: fuer diese Partie lag kein Spielkontext vor. Das ist etwas anderes als
  // ein leerer Befund, siehe researchStateOf().
  llm?: {
    foundAnything: boolean;
    // Seit dem 01.09.2026 mitgeschrieben. Aeltere Zeilen kennen das Feld nicht.
    webSearches?: number | null;
  } | null;
}

// Drei Zustaende, die im gepaarten Test NICHT dasselbe sind:
//
//   "recherchiert"   -- die Behandlung wurde verabreicht. Ob sie etwas gefunden hat, ist
//                       das Ergebnis und gehoert in die Auswertung, auch als Nullbefund.
//   "ohne_recherche" -- die Behandlung wurde gar nicht verabreicht (Recherche
//                       fehlgeschlagen oder nie gelaufen). Die Zeile ist keine Beobachtung
//                       des Layers und darf den gepaarten Vergleich nicht auffuellen.
//   "unbekannt"      -- Zeile von vor dem 01.09.2026: ein Kontext lag vor, aber ohne
//                       Suchzahl laesst sich nicht mehr pruefen, ob wirklich recherchiert
//                       wurde. Genau dieser blinde Fleck hat Spieltag 1 gekostet.
type ResearchState = "recherchiert" | "ohne_recherche" | "unbekannt";

function researchStateOf(entry: LogEntry): ResearchState {
  if (entry.llm == null) return "ohne_recherche";
  if (entry.llm.webSearches == null) return "unbekannt";
  // Null Suchen kann seit dem Riegel in refreshLlmContext nicht mehr entstehen. Bleibt
  // als Pruefung stehen, weil aeltere Zeilen es enthalten koennen.
  return entry.llm.webSearches > 0 ? "recherchiert" : "ohne_recherche";
}

if (!existsSync(LOG_PATH)) {
  console.log("Noch kein Vorwaerts-Log vorhanden. Zuerst `npm run forward-log` laufen lassen.");
  process.exit(0);
}

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

const pool = process.argv.includes("--pool");
const forceMatchList = process.argv.includes("--matches");
const benchmark = parseBenchmarkSource(flag("benchmark"));

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

const results = new Map<string, Match>();
for (const m of loadAllMatches()) {
  results.set(`${m.season}|${m.homeTeam}|${m.awayTeam}`, m);
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

interface Settled {
  entry: LogEntry;
  match: Match;
  homeGoals: number;
  awayGoals: number;
}

function metricsOf(
  probs: OutcomeProbs,
  over25: number | null | undefined,
  cellProb: number | null,
  homeGoals: number,
  awayGoals: number
): PerMatchMetrics {
  const actual = outcomeOf(homeGoals, awayGoals);
  const overHappened = homeGoals + awayGoals > 2.5;
  return {
    predicted: argmaxOutcome(probs),
    actual,
    rps: rankedProbabilityScore(probs, actual),
    logLoss: logLoss(probs, actual),
    brier: brierScore(probs, actual),
    // Bewusst == statt ===: aeltere Logzeilen kennen das Feld gar nicht, und undefined
    // durchzulassen erzeugt stillschweigend NaN in der Zusammenfassung.
    totals:
      over25 == null
        ? null
        : {
            logLoss: binaryLogLoss(over25, overHappened),
            brier: binaryBrier(over25, overHappened),
          },
    handicap: null,
    scoreLogLoss: cellProb === null ? null : scoreLogLoss(cellProb),
  };
}

function fairOdds(prob: number): string {
  if (prob <= 0) return "  —  ";
  return (1 / prob).toFixed(2).padStart(5);
}

function oddsLine(label: string, probs: OutcomeProbs, trailer: string): string {
  return (
    `      ${label.padEnd(8)} ` +
    `${fairOdds(probs.homeWinProb)} / ${fairOdds(probs.drawProb)} / ${fairOdds(probs.awayWinProb)}` +
    `   ${trailer}`
  );
}

for (const group of groups) {
  const settled: Settled[] = [];
  let pending = 0;
  for (const entry of group.entries) {
    const match = results.get(`${entry.season}|${entry.homeTeam}|${entry.awayTeam}`);
    if (!match) {
      pending++;
      continue;
    }
    settled.push({ entry, match, homeGoals: match.homeGoals, awayGoals: match.awayGoals });
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
      rows.push(
        metricsOf(
          variant.probs,
          variant.over25,
          scoreProbOf(variant, s.homeGoals, s.awayGoals),
          s.homeGoals,
          s.awayGoals
        )
      );
    }
    perVariant.set(name, rows);
    console.log(formatSummary(name, summarize(rows)));
  }

  // -------------------------------------------------------------------------
  // Frage 1: bringt der Spielkontext etwas?
  // -------------------------------------------------------------------------
  // Gepaart wird ueber die Zeilen selbst, nicht ueber die weiter oben gebauten
  // Variantenlisten: dort wird eine Zeile ohne die jeweilige Variante uebersprungen, und
  // zwei so entstandene Listen waeren gegeneinander verschoben, ohne dass es auffiele.
  const paired: { entry: LogEntry; base: PerMatchMetrics; llm: PerMatchMetrics }[] = [];
  const skipped: Record<ResearchState, number> = {
    recherchiert: 0,
    ohne_recherche: 0,
    unbekannt: 0,
  };

  for (const s of settled) {
    const base = s.entry.variants["model"];
    const treat = s.entry.variants["withLlm"];
    if (!base || !treat) continue;

    const state = researchStateOf(s.entry);
    // Zeilen ohne verabreichte Behandlung fliegen raus. Sie haben in beiden Varianten
    // exakt dieselben Zahlen und wuerden den gepaarten Test nur mit Nullen auffuellen --
    // das druckt n hoch, ohne ein einziges Bit Evidenz beizusteuern.
    if (state === "ohne_recherche") {
      skipped.ohne_recherche++;
      continue;
    }
    if (state === "unbekannt") skipped.unbekannt++;

    const cell = (v: Variant) => scoreProbOf(v, s.homeGoals, s.awayGoals);
    paired.push({
      entry: s.entry,
      base: metricsOf(base.probs, base.over25, cell(base), s.homeGoals, s.awayGoals),
      llm: metricsOf(treat.probs, treat.over25, cell(treat), s.homeGoals, s.awayGoals),
    });
  }

  if (paired.length > 0) {
    let onlyA = 0;
    let onlyB = 0;
    const rpsDiffs: number[] = [];
    // Getrennt gefuehrt, weil die Fallzahlrechnung darauf und nicht auf der Gesamtmenge
    // beruhen muss -- siehe unten.
    const movedDiffs: number[] = [];

    for (const p of paired) {
      const aRight = p.llm.predicted === p.llm.actual;
      const bRight = p.base.predicted === p.base.actual;
      if (aRight && !bRight) onlyA++;
      else if (!aRight && bRight) onlyB++;
      const d = p.base.rps - p.llm.rps;
      rpsDiffs.push(d);
      if (Math.abs(d) > 1e-9) movedDiffs.push(d);
    }

    console.log(`\nSpielkontext gegen Basismodell (positiv = Kontext besser):`);

    if (skipped.ohne_recherche > 0) {
      console.log(
        `  ${skipped.ohne_recherche} Spiele ohne Spielkontext ausgeschlossen. Dort wurde die\n` +
          `  Recherche nie verabreicht -- solche Zeilen sind keine Beobachtung des Layers,\n` +
          `  sondern nur Nullen, die n aufblaehen.`
      );
    }
    if (skipped.unbekannt > 0) {
      console.log(
        `  Achtung: bei ${skipped.unbekannt} Spielen ist unbekannt, ob wirklich recherchiert\n` +
          `  wurde -- Zeilen von vor dem 01.09.2026 fuehren keine Suchzahl. Sie sind\n` +
          `  enthalten, koennten aber stille Nullbefunde sein (siehe SAISONBETRIEB.md).`
      );
    }

    console.log(`  ${formatMcNemar("Tendenz", mcnemarExact(onlyA, onlyB))}`);
    console.log(`  ${formatBootstrap("RPS", pairedBootstrap(rpsDiffs))}`);
    console.log(
      `  Der Kontext hat auf ${movedDiffs.length} von ${rpsDiffs.length} recherchierten Spielen\n` +
        `  ueberhaupt etwas veraendert. Auf den uebrigen ist die Differenz exakt 0 und sie\n` +
        `  verduennen den Mittelwert -- deshalb steht die Zahl hier daneben.`
    );

    // Wie viel Evidenz braucht es ueberhaupt? Diese Zahl neben dem aktuellen n zu drucken
    // verhindert, dass ein frueher, zufaellig positiver Zwischenstand ueberinterpretiert
    // wird.
    //
    // Gerechnet wird auf den BEWEGTEN Spielen und danach auf die Gesamtmenge
    // hochgerechnet. Die Streuung ueber alle Zeilen zu nehmen waere bequem und falsch:
    // exakte Nullen druecken die Streuung, die noetige Fallzahl geht mit ihrem Quadrat,
    // und heraus kaeme eine zu optimistische Zahl -- ausgerechnet bei der Groesse, die vor
    // Ueberinterpretation schuetzen soll.
    if (movedDiffs.length > 1) {
      const mean = movedDiffs.reduce((s, d) => s + d, 0) / movedDiffs.length;
      const sd = Math.sqrt(
        movedDiffs.reduce((s, d) => s + (d - mean) ** 2, 0) / Math.max(1, movedDiffs.length - 1)
      );
      const target = 0.005; // ein Effekt in der Groessenordnung, die den Marktabstand schliessen wuerde
      const neededMoved = sd > 0 ? Math.ceil(((1.96 * sd) / target) ** 2) : 0;
      // Anteil der Spiele, die der Layer ueberhaupt anfasst. Um so viele Spiele mehr
      // braucht es insgesamt, damit am Ende genug BEWEGTE darunter sind.
      const moveRate = movedDiffs.length / rpsDiffs.length;
      const neededTotal = moveRate > 0 ? Math.ceil(neededMoved / moveRate) : 0;
      console.log(
        `\n  Streuung der RPS-Differenz auf den bewegten Spielen: ${sd.toFixed(4)}.\n` +
          `  Um dort einen Effekt von ${target} RPS mit 95% Sicherheit von Null zu trennen,\n` +
          `  braucht es rund ${neededMoved} bewegte Spiele. Bei einer Trefferquote von\n` +
          `  ${(moveRate * 100).toFixed(0)}% sind das rund ${neededTotal} protokollierte Spiele ` +
          `(${(neededTotal / 306).toFixed(1)} Saisons).\n` +
          `  Aktuell: ${movedDiffs.length} bewegte von ${rpsDiffs.length} recherchierten.`
      );
    }
  }

  // -------------------------------------------------------------------------
  // Frage 2: wo stehen wir gegen den Buchmacher?
  // -------------------------------------------------------------------------
  const quoted: { s: Settled; quote: BenchmarkQuote }[] = [];
  for (const s of settled) {
    const quote = benchmarkQuote(s.match, benchmark);
    if (quote) quoted.push({ s, quote });
  }

  console.log(`\n--- Gegen den Buchmacher (${BENCHMARK_LABELS[benchmark]}) ---`);

  if (quoted.length === 0) {
    console.log(
      `Fuer keines der ${settled.length} ausgewerteten Spiele liegt eine Referenzquote vor.\n` +
        `Die Ergebnisse der laufenden Saison kommen aus OpenLigaDB und bringen keine Quoten mit.\n` +
        `"npm run refresh-market" holt sie von football-data nach -- dort erscheinen sie ein bis\n` +
        `drei Tage nach dem Spieltag.`
    );
    continue;
  }

  if (quoted.length < settled.length) {
    console.log(
      `${quoted.length} von ${settled.length} Spielen haben eine Referenzquote. Die uebrigen ` +
        `fallen aus\nallen Varianten heraus, damit der Vergleich auf derselben Spielmenge laeuft.` +
        (benchmark === "pinnacleClose"
          ? `\nPinnacle ist in den Dateien loechrig geworden -- "--benchmark=marketAverageClose" ` +
            `deckt\nmehr Spiele ab, ist als Gegner aber etwas weicher.`
          : "")
    );
  }

  // Alle drei Varianten auf exakt dieser Teilmenge, in identischer Reihenfolge.
  const marketRows: PerMatchMetrics[] = [];
  const ourRows = new Map<string, PerMatchMetrics[]>();
  for (const name of variantNames) ourRows.set(name, []);

  for (const { s, quote } of quoted) {
    marketRows.push(
      metricsOf(quote.probs, quote.totalsOverProb, null, s.homeGoals, s.awayGoals)
    );
    for (const name of variantNames) {
      const variant = s.entry.variants[name];
      if (!variant) continue;
      ourRows
        .get(name)!
        .push(
          metricsOf(
            variant.probs,
            variant.over25,
            scoreProbOf(variant, s.homeGoals, s.awayGoals),
            s.homeGoals,
            s.awayGoals
          )
        );
    }
  }

  console.log("");
  for (const name of variantNames) {
    const rows = ourRows.get(name)!;
    if (rows.length === quoted.length) console.log(formatSummary(name, summarize(rows)));
  }
  console.log(formatSummary("markt", summarize(marketRows)));

  console.log(`\nAbstand zum Buchmacher (positiv = wir besser):`);
  for (const name of variantNames) {
    const rows = ourRows.get(name)!;
    if (rows.length !== quoted.length) continue;
    const rpsDiffs = rows.map((r, i) => marketRows[i].rps - r.rps);
    const llDiffs = rows.map((r, i) => marketRows[i].logLoss - r.logLoss);
    console.log(`  ${formatBootstrap(`${name}: RPS`, pairedBootstrap(rpsDiffs))}`);
    console.log(`  ${formatBootstrap(`${name}: LogLoss`, pairedBootstrap(llDiffs))}`);
  }

  // -------------------------------------------------------------------------
  // Die Gegenueberstellung Spiel fuer Spiel. Alle Quoten sind FAIRE Quoten (1/p): beim
  // Buchmacher ist die Marge herausgerechnet, sonst saehe seine Seite systematisch
  // schaerfer aus, als sie ist. Die Marge steht daneben, damit sichtbar bleibt, wie viel
  // herausgerechnet wurde.
  // -------------------------------------------------------------------------
  const listLimit = 60;
  if (!forceMatchList && quoted.length > listLimit) {
    console.log(
      `\n${quoted.length} Spiele -- die Einzelaufstellung bleibt aus. Mit --matches erzwingen.`
    );
    continue;
  }

  console.log(`\nQuoten Spiel fuer Spiel (faire Quoten 1/p, Marge herausgerechnet):`);
  let currentMatchday = -1;
  for (const { s, quote } of quoted) {
    if (s.entry.matchday !== currentMatchday) {
      currentMatchday = s.entry.matchday;
      console.log(`\n  Spieltag ${currentMatchday}`);
    }
    const actual = outcomeOf(s.homeGoals, s.awayGoals);
    console.log(
      `    ${`${s.entry.homeTeam} – ${s.entry.awayTeam}`.padEnd(40)}` +
        `${s.homeGoals}:${s.awayGoals} (${actual})`
    );
    for (const name of variantNames) {
      const variant = s.entry.variants[name];
      if (!variant) continue;
      const rps = rankedProbabilityScore(variant.probs, actual);
      console.log(oddsLine(name, variant.probs, `RPS ${rps.toFixed(4)}`));
    }
    console.log(
      oddsLine(
        "markt",
        quote.probs,
        `RPS ${rankedProbabilityScore(quote.probs, actual).toFixed(4)}   ` +
          `Marge ${((quote.overround - 1) * 100).toFixed(1)} %`
      )
    );
  }
}
