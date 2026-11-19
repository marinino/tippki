// Der Kandidat fuer 2027/28 (src/model/candidate.ts) gegen die Produktion.
//
//   npm run kandidat                         Validation: wie der Kandidat dasteht, zum Nachvollziehen
//   npm run kandidat -- --temperatur-scan    Validation: der Scan, mit dem T gewaehlt wurde, plus ρ-Kontrolle
//   npm run kandidat -- --trockenlauf        der Auswertungsweg der Bestaetigung, durchgespielt auf Validation
//   npm run kandidat -- --bestaetigung       MESSLAUF.md, Messplan 2: EINMAL, nach Saisonende 2026/27
//
// Nur Auswertung: aendert keine Vorhersage und keinen configHash.
//
// Die Bestaetigung ist mechanisch gesperrt, bis die Saison 2026/27 vollstaendig ist, und sie
// verweigert, wenn der Kandidat nach dem Festschreiben veraendert wurde (Abdruck) oder der
// Commit, der ihn einfuehrt, nach dem ersten gewerteten Anpfiff liegt. Regel, Kennzahlen und
// Entscheidung stehen in MESSLAUF.md und hier im Code -- beide wurden VOR den Daten festgelegt.

import { execFileSync } from "child_process";
import { loadAllMatches, parseMatchDate } from "../data/loadMatches";
import { PRODUCTION_MODEL_OPTIONS, buildLeagueModel, type LeagueModelOptions } from "../model/teamStrength";
import { XG_FORM_WEIGHT } from "../model/xgForm";
import {
  CANDIDATE_2027,
  CANDIDATE_FINGERPRINT,
  candidateFingerprint,
  candidateModelOptions,
} from "../model/candidate";
import { configHash } from "../model/pipelineConfig";
import {
  buildWalkForwardContexts,
  candidateRunSpec,
  evaluateRun,
  type MatchEvaluation,
  type RunSpec,
  type SeasonContexts,
} from "../eval/backtestCore";
import { BENCHMARK_LABELS, DEFAULT_BENCHMARK } from "../eval/benchmarkOdds";
import { calibrationBins } from "../eval/calibration";
import { formatSummary, summarize } from "../eval/metrics";
import { pairedBootstrap, type BootstrapResult } from "../eval/significance";
import { FORWARD_SEASON, TEST_SEASONS, VALIDATION_SEASONS } from "../eval/splits";

const flag = (name: string) => process.argv.includes(`--${name}`);
const allMatches = loadAllMatches();

const PROD: RunSpec = { name: "produktion", variant: "model" };
const CAND: RunSpec = candidateRunSpec();
const MARKT: RunSpec = { name: "markt", variant: "benchmark" };

type Pick = (e: MatchEvaluation) => number | null;
const PICK: Record<"rps" | "ll" | "ou" | "ah" | "cs", Pick> = {
  rps: (e) => e.metrics.rps,
  ll: (e) => e.metrics.logLoss,
  ou: (e) => e.metrics.totals?.logLoss ?? null,
  ah: (e) => e.metrics.handicap?.logLoss ?? null,
  cs: (e) => e.metrics.scoreLogLoss,
};

const f4 = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(4)}`;
const fmt = (r: BootstrapResult) => `${f4(r.meanDiff)} [${f4(r.ciLow)}, ${f4(r.ciHigh)}] p=${r.pValue.toFixed(3)}`;
// Einseitig fuer "der zweite Lauf ist besser" aus dem zweiseitigen Bootstrap-p.
const oneSided = (r: BootstrapResult) => (r.meanDiff > 0 ? r.pValue / 2 : 1 - r.pValue / 2);

function contexts(seasons: string[], options: LeagueModelOptions, fromDay?: Date): SeasonContexts[] {
  const built = buildWalkForwardContexts(seasons, options, allMatches, buildLeagueModel, DEFAULT_BENCHMARK);
  if (!fromDay) return built;
  return built.map((s) => ({
    ...s,
    contexts: s.contexts.filter((c) => parseMatchDate(c.date).getTime() >= fromDay.getTime()),
  }));
}

// B1 aus MESSLAUF.md: produktive Form, Exponent 0,2 * Form auf ±0,15 geklammert. Dieselbe
// Umsetzung wie in messlauf.ts -- die Klammer auf dem Exponenten ist eine auf der Form.
function clampForm(ctxs: SeasonContexts[], limit = 0.15): SeasonContexts[] {
  const c = limit / XG_FORM_WEIGHT;
  const clamp = (f: number) => Math.max(-c, Math.min(c, f));
  return ctxs.map((s) => ({
    ...s,
    contexts: s.contexts.map((x) => ({ ...x, homeForm: clamp(x.homeForm), awayForm: clamp(x.awayForm) })),
  }));
}

// a − b je Spiel; bei "kleiner ist besser" heisst positiv: b ist besser.
function paired(a: MatchEvaluation[], b: MatchEvaluation[], pick: Pick): BootstrapResult {
  if (a.length !== b.length) throw new Error(`ungepaart: ${a.length} gegen ${b.length} Spiele`);
  const diffs: number[] = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i].date !== b[i].date || a[i].homeTeam !== b[i].homeTeam || a[i].awayTeam !== b[i].awayTeam) {
      throw new Error(`ungepaart: Reihenfolge bei Spiel ${i}`);
    }
    const x = pick(a[i]);
    const y = pick(b[i]);
    if (x === null || y === null) continue;
    diffs.push(x - y);
  }
  return pairedBootstrap(diffs);
}

const meanOf = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const pct = (x: number) => (100 * x).toFixed(1);

function masses(label: string, ev: MatchEvaluation[]) {
  console.log(
    `  ${label.padEnd(22)} ${pct(meanOf(ev.map((e) => e.probs.homeWinProb)))} / ${pct(meanOf(ev.map((e) => e.probs.drawProb)))} / ${pct(meanOf(ev.map((e) => e.probs.awayWinProb)))}`
  );
}

// Das projekteigene Kriterium: wird ein Modell nur marktaehnlicher, oder besser, wo es
// widerspricht? Spiele mit mehr als 12 Prozentpunkten Abstand zur Schlussquote auf einem
// Ausgang, und der RPS-Rueckstand darin.
function disagreement(ev: MatchEvaluation[], market: MatchEvaluation[]) {
  const idx = ev
    .map((e, i) => {
      const b = e.benchmarkProbs!;
      const gap = Math.max(
        Math.abs(e.probs.homeWinProb - b.homeWinProb),
        Math.abs(e.probs.drawProb - b.drawProb),
        Math.abs(e.probs.awayWinProb - b.awayWinProb)
      );
      return gap > 0.12 ? i : -1;
    })
    .filter((i) => i >= 0);
  const r = pairedBootstrap(idx.map((i) => ev[i].metrics.rps - market[i].metrics.rps));
  return `${idx.length} uneinige Spiele, RPS-Rueckstand dort ${f4(r.meanDiff)} [${f4(r.ciLow)}, ${f4(r.ciHigh)}]`;
}

function compare(label: string, prod: MatchEvaluation[], cand: MatchEvaluation[], market: MatchEvaluation[]) {
  console.log(`\n--- ${label} (n = ${prod.length}) ---`);
  console.log(formatSummary("Produktion", summarize(prod.map((e) => e.metrics))));
  console.log(formatSummary("Kandidat", summarize(cand.map((e) => e.metrics))));
  console.log(formatSummary(`Markt (${BENCHMARK_LABELS[DEFAULT_BENCHMARK]})`, summarize(market.map((e) => e.metrics))));
  console.log("\n  Kandidat gegen Produktion (positiv = Kandidat besser):");
  for (const [k, name] of [["rps", "1X2 RPS"], ["ll", "1X2 LogLoss"], ["ou", "Ü/U 2,5 LogLoss"], ["ah", "AH LogLoss"], ["cs", "exaktes Ergebnis"]] as const) {
    console.log(`    ${name.padEnd(18)} ${fmt(paired(prod, cand, PICK[k]))}`);
  }
  console.log("\n  Rueckstand zum Markt (positiv = Markt besser):");
  for (const [k, name] of [["rps", "1X2 RPS"], ["ll", "1X2 LogLoss"], ["ou", "Ü/U 2,5 LogLoss"]] as const) {
    console.log(`    ${name.padEnd(18)} Produktion ${fmt(paired(prod, market, PICK[k]))}   Kandidat ${fmt(paired(cand, market, PICK[k]))}`);
  }
  console.log("\n  Mittlere 1X2-Masse (Heim / Remis / Gast):");
  masses("Produktion", prod);
  masses("Kandidat", cand);
  masses("Markt", market);
  const actual = prod.map((e) => e.actual);
  console.log(
    `  ${"tatsaechlich".padEnd(22)} ${pct(meanOf(actual.map((a) => (a === "H" ? 1 : 0))))} / ${pct(meanOf(actual.map((a) => (a === "D" ? 1 : 0))))} / ${pct(meanOf(actual.map((a) => (a === "A" ? 1 : 0))))}`
  );
  console.log(`\n  Produktion: ${disagreement(prod, market)}`);
  console.log(`  Kandidat:   ${disagreement(cand, market)}`);
}

function header() {
  const fp = candidateFingerprint();
  console.log(`configHash der Produktion ${configHash()}`);
  console.log(`Kandidat ${CANDIDATE_2027.name}: Abdruck ${fp}${fp === CANDIDATE_FINGERPRINT ? " (festgeschrieben)" : `  ACHTUNG: festgeschrieben ist ${CANDIDATE_FINGERPRINT}`}`);
  console.log(`Messlatte: ${BENCHMARK_LABELS[DEFAULT_BENCHMARK]}, walk-forward wie produktiv\n`);
  return fp === CANDIDATE_FINGERPRINT;
}

// ---------------------------------------------------------------------------
// Validation: wie der Kandidat dasteht. Keine Entscheidung -- auf genau diesen Spielen wurde er
// zusammengesetzt.
function validationReport() {
  console.log(`Validation (${VALIDATION_SEASONS.join(", ")}). Auf diesen Spielen wurde der Kandidat gewaehlt, die Zahlen sind deshalb zu optimistisch.`);
  const prodCtx = contexts(VALIDATION_SEASONS, PRODUCTION_MODEL_OPTIONS);
  const candCtx = contexts(VALIDATION_SEASONS, candidateModelOptions());
  compare("Validation", evaluateRun(prodCtx, PROD), evaluateRun(candCtx, CAND), evaluateRun(prodCtx, MARKT));
}

// Der Scan, mit dem T gewaehlt wurde. Regel, vor dem Lauf festgelegt: kleinster 1X2-LogLoss im
// Gitter. ρ wird hier nicht gewaehlt: es bleibt beim produktiven Wert, weil der Fuenf-Ligen-
// Befund je Liga nicht fuer die Bundesliga traegt (candidate.ts, RECHERCHE.md Abschnitt 2).
// Die ρ-Zeilen sind die Kontrolle, die das am 2026-11-19 gezeigt hat.
function temperatureScan() {
  const candCtx = contexts(VALIDATION_SEASONS, candidateModelOptions());
  console.log(`Temperatur-Scan fuer den Kandidaten auf Validation (${VALIDATION_SEASONS.join(", ")}), Bezug Grundrate, ρ = ${CANDIDATE_2027.rho}`);
  console.log("  T       RPS      LogLoss   Ü/U      Ergebnis  Kalibrierungsfehler");
  const rows = [1.0, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.4, 1.5].map((T) => {
    const ev = evaluateRun(candCtx, { ...CAND, outcomeTemperature: T });
    const s = summarize(ev.map((e) => e.metrics));
    const ece = calibrationBins(ev.map((e) => ({ probs: e.probs, actual: e.actual }))).expectedCalibrationError;
    return { T, s, ece };
  });
  const best = rows.reduce((a, b) => (b.s.logLoss < a.s.logLoss ? b : a));
  for (const r of rows) {
    console.log(
      `  ${r.T.toFixed(2)}    ${r.s.rps.toFixed(4)}   ${r.s.logLoss.toFixed(4)}    ${r.s.totalsLogLoss.toFixed(4)}   ${r.s.scoreLogLoss.toFixed(4)}    ${(100 * r.ece).toFixed(2)} pp` +
        `${r === best ? "   <- kleinster LogLoss" : ""}${r.T === CANDIDATE_2027.outcomeTemperature ? "   <- festgeschrieben" : ""}`
    );
  }
  console.log(`\nρ-Kontrolle bei T = ${CANDIDATE_2027.outcomeTemperature} (keine Auswahl; ρ bleibt produktiv, siehe candidate.ts):`);
  console.log("  ρ        RPS      LogLoss   Ü/U      Ergebnis");
  for (const rho of [-0.15, -0.1, -0.05, 0]) {
    const s = summarize(evaluateRun(candCtx, { ...CAND, rho }).map((e) => e.metrics));
    console.log(`  ${rho.toFixed(2).padStart(5)}    ${s.rps.toFixed(4)}   ${s.logLoss.toFixed(4)}    ${s.totalsLogLoss.toFixed(4)}   ${s.scoreLogLoss.toFixed(4)}${rho === CANDIDATE_2027.rho ? "   <- festgeschrieben" : ""}`);
  }
}

// ---------------------------------------------------------------------------
// Die Bestaetigung, exakt wie in MESSLAUF.md, Messplan 2:
//
//   K1  Kandidat gegen Produktion. Primaer: LogLoss auf dem exakten Ergebnis, einseitig, auf
//       Test (2023-2025) und Vorwaertssaison ab dem ersten gewerteten Anpfiff zusammen.
//       Ausschluss: 1X2-LogLoss oder RPS signifikant schlechter (zweiseitig, p < 0,05).
//   B1  Klammer ±0,15 gegen Produktion, wie am 18.11. festgelegt: Ü/U-LogLoss, einseitig, nur
//       Test. Ausschluss: RPS signifikant schlechter.
//   Holm ueber K1 und B1, α = 0,05. K1 vor B1: bestehen beide, wird K1 produktiv.
function confirmation(opts: { test: string[]; forward: string; fromDay: Date; dryRun: boolean }) {
  const { test, forward, fromDay, dryRun } = opts;
  if (dryRun) {
    console.log("############################################################################");
    console.log("#  TROCKENLAUF auf Validation-Saisons. Prueft den Auswertungsweg, entscheidet  #");
    console.log("#  nichts. Die echte Bestaetigung: --bestaetigung, einmal, nach Saisonende.     #");
    console.log("############################################################################\n");
  }
  console.log(`Test: ${test.join(", ")}   Vorwaerts: ${forward} ab ${fromDay.toLocaleDateString("de-DE")}`);

  const testProd = contexts(test, PRODUCTION_MODEL_OPTIONS);
  const testCand = contexts(test, candidateModelOptions());
  const fwdProd = contexts([forward], PRODUCTION_MODEL_OPTIONS, fromDay);
  const fwdCand = contexts([forward], candidateModelOptions(), fromDay);

  const ev = {
    test: { prod: evaluateRun(testProd, PROD), cand: evaluateRun(testCand, CAND), b1: evaluateRun(clampForm(testProd), PROD), mkt: evaluateRun(testProd, MARKT) },
    fwd: { prod: evaluateRun(fwdProd, PROD), cand: evaluateRun(fwdCand, CAND), b1: evaluateRun(clampForm(fwdProd), PROD), mkt: evaluateRun(fwdProd, MARKT) },
  };
  const pooledProd = [...ev.test.prod, ...ev.fwd.prod];
  const pooledCand = [...ev.test.cand, ...ev.fwd.cand];

  const k1 = paired(pooledProd, pooledCand, PICK.cs);
  const k1ll = paired(pooledProd, pooledCand, PICK.ll);
  const k1rps = paired(pooledProd, pooledCand, PICK.rps);
  const k1worse = (k1ll.meanDiff < 0 && k1ll.pValue < 0.05) || (k1rps.meanDiff < 0 && k1rps.pValue < 0.05);

  const b1 = paired(ev.test.prod, ev.test.b1, PICK.ou);
  const b1rps = paired(ev.test.prod, ev.test.b1, PICK.rps);
  const b1worse = b1rps.meanDiff < 0 && b1rps.pValue < 0.05;

  const p = { k1: oneSided(k1), b1: oneSided(b1) };
  const [first, second] = p.k1 <= p.b1 ? (["k1", "b1"] as const) : (["b1", "k1"] as const);
  const holm: Record<"k1" | "b1", number> = { k1: 0, b1: 0 };
  holm[first] = Math.min(1, 2 * p[first]);
  holm[second] = Math.max(holm[first], p[second]);

  const k1ok = k1.meanDiff > 0 && holm.k1 < 0.05 && !k1worse;
  const b1ok = b1.meanDiff > 0 && holm.b1 < 0.05 && !b1worse;

  console.log("\n=== Entscheidung (Messplan 2) ===");
  console.log(`K1 Kandidat, exaktes Ergebnis (Test + Vorwaerts, n = ${k1.n}): ${fmt(k1)}  einseitig p = ${p.k1.toFixed(4)}, Holm ${holm.k1.toFixed(4)}`);
  console.log(`   Ausschluss 1X2-LogLoss ${fmt(k1ll)}   RPS ${fmt(k1rps)}   -> ${k1worse ? "AUSGESCHLOSSEN" : "kein Ausschluss"}`);
  console.log(`B1 Klammer ±0,15, Ü/U-LogLoss (nur Test, n = ${b1.n}): ${fmt(b1)}  einseitig p = ${p.b1.toFixed(4)}, Holm ${holm.b1.toFixed(4)}`);
  console.log(`   Ausschluss RPS ${fmt(b1rps)}   -> ${b1worse ? "AUSGESCHLOSSEN" : "kein Ausschluss"}`);
  const verdict = k1ok
    ? "K1 besteht: der Kandidat wird zur Saison 2027/28 produktiv (neuer configHash, neuer Freeze)."
    : b1ok
      ? "K1 besteht nicht, B1 besteht: die Klammer ±0,15 wird zur Saison 2027/28 produktiv."
      : "Kein Kandidat besteht: die Produktion bleibt. Das heisst 'kein Nachweis', nicht 'kein Effekt'.";
  console.log(`\n${dryRun ? "(Trockenlauf, ohne Bedeutung) " : ""}${verdict}`);

  console.log("\n=== Berichtet, ohne Entscheidungskraft ===");
  compare(`Test ${test.join(", ")}`, ev.test.prod, ev.test.cand, ev.test.mkt);
  compare(`Vorwaerts ${forward} ab ${fromDay.toLocaleDateString("de-DE")}`, ev.fwd.prod, ev.fwd.cand, ev.fwd.mkt);
  console.log(`\n  B1 auf der Vorwaertssaison (zweite Bestaetigung, ohne Entscheidungskraft): Ü/U ${fmt(paired(ev.fwd.prod, ev.fwd.b1, PICK.ou))}`);
}

// Zeitpunkt des Commits, der candidate.ts einfuehrt (Autorendatum: uebersteht Rebase und
// Merge-Commits). null, wenn git fehlt oder die Datei nicht committet ist.
function frozenCommitTime(): Date | null {
  try {
    const out = execFileSync("git", ["log", "--diff-filter=A", "--format=%aI", "--", "src/model/candidate.ts"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const lines = out.split(/\r?\n/).filter(Boolean);
    return lines.length > 0 ? new Date(lines[lines.length - 1]) : null;
  } catch {
    return null;
  }
}

// Kalendertag des ersten gewerteten Anpfiffs, lokal wie parseMatchDate.
function firstEvaluatedDay(): Date {
  const [y, m, d] = CANDIDATE_2027.firstEvaluatedKickoff.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

// ---------------------------------------------------------------------------

const intact = header();

if (flag("bestaetigung")) {
  const seasonGames = allMatches.filter((m) => m.season === FORWARD_SEASON).length;
  const committed = frozenCommitTime();
  const kickoff = new Date(CANDIDATE_2027.firstEvaluatedKickoff);
  const problems: string[] = [];
  if (!intact) problems.push("der Kandidat wurde nach dem Festschreiben veraendert (Abdruck weicht ab)");
  if (seasonGames < 306) problems.push(`die Saison ${FORWARD_SEASON}/${Number(FORWARD_SEASON) + 1 - 2000} ist nicht vollstaendig (${seasonGames} von 306 Spielen)`);
  if (!committed) problems.push("kein Commit fuer src/model/candidate.ts gefunden -- festgeschrieben ist nur, was committet ist");
  else if (committed.getTime() >= kickoff.getTime()) {
    problems.push(`der Commit (${committed.toISOString()}) liegt nicht vor dem ersten gewerteten Anpfiff (${kickoff.toISOString()})`);
  }
  if (problems.length > 0) {
    console.log("Die Bestaetigung laeuft nicht:");
    for (const p of problems) console.log(`  - ${p}`);
    console.log("\nSiehe MESSLAUF.md, Messplan 2. Fuer einen Probelauf: --trockenlauf.");
    process.exit(1);
  }
  console.log(`Festgeschrieben am ${committed!.toISOString()}, erster gewerteter Anpfiff ${kickoff.toISOString()}.\n`);
  confirmation({ test: TEST_SEASONS, forward: FORWARD_SEASON, fromDay: firstEvaluatedDay(), dryRun: false });
} else if (flag("trockenlauf")) {
  // Stellvertreter aus der Validation: zwei Saisons als "Test", die dritte ab November als
  // "Vorwaerts". Dieselben Funktionen wie die echte Bestaetigung.
  confirmation({ test: ["2020", "2021"], forward: "2022", fromDay: new Date(2022, 10, 1), dryRun: true });
} else if (flag("temperatur-scan")) {
  temperatureScan();
} else {
  validationReport();
}
