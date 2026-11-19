// Die Mehrliga-Messbasis (src/data/leagues.ts, src/eval/leagueBacktest.ts).
//
//   npm run ligen                 Abdeckung je Liga, Abgleich mit RECHERCHE.md und der
//                                 Ausgangsstand Produktion gegen Markt, alles auf der Entwicklung
//   npm run ligen -- --kandidat   der festgeschriebene Kandidat 2027/28 gegen die Produktion je
//                                 Liga, explorativ (ausserhalb der Bundesliga ohne xG)
//
// Nur Auswertung: aendert keine Vorhersage und keinen configHash. Die Holdout-Saisons 2023 bis
// 2025 fasst dieses Skript nicht an -- die Abdeckung zaehlt dort nur Zeilen und Quoten, keine
// Ergebnisse, und jeder Walk-forward laeuft ueber die Sperre in leagueBacktest.ts.

import { LEAGUES, LEAGUE_SEASONS, loadLeagueMatches, teamsInSeason, type LeagueCode } from "../data/leagues";
import { PRODUCTION_MODEL_OPTIONS } from "../model/teamStrength";
import { candidateModelOptions } from "../model/candidate";
import { candidateRunSpec, evaluateRun, type MatchEvaluation, type RunSpec } from "../eval/backtestCore";
import {
  LEAGUE_BENCHMARK,
  LEAGUE_DEVELOPMENT_SEASONS,
  LEAGUE_HOLDOUT_SEASONS,
  leagueWalkForward,
  pairedByLeague,
} from "../eval/leagueBacktest";
import { BENCHMARK_LABELS } from "../eval/benchmarkOdds";
import type { BootstrapResult } from "../eval/significance";

const flag = (name: string) => process.argv.includes(`--${name}`);
const DEV = LEAGUE_DEVELOPMENT_SEASONS;
const PROD: RunSpec = { name: "produktion", variant: "model" };
const BASE: RunSpec = { name: "basis", variant: "model", xgFormWeight: 0, outcomeTemperature: 1 };
const MARKT: RunSpec = { name: "markt", variant: "benchmark" };
const CAND = candidateRunSpec();

const f4 = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(4)}`;
const star = (r: BootstrapResult) => (r.pValue < 0.01 ? "**" : r.pValue < 0.05 ? "* " : "  ");
const ci = (r: BootstrapResult) => `${f4(r.meanDiff)} [${f4(r.ciLow)}, ${f4(r.ciHigh)}]${star(r)}`;
const pct = (num: number, den: number) => (den === 0 ? "  –  " : `${((100 * num) / den).toFixed(0).padStart(3)} %`);
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

type Pick = (e: MatchEvaluation) => number | null;
const PICK: Record<"rps" | "ll" | "ou" | "cs", Pick> = {
  rps: (e) => e.metrics.rps,
  ll: (e) => e.metrics.logLoss,
  ou: (e) => e.metrics.totals?.logLoss ?? null,
  cs: (e) => e.metrics.scoreLogLoss,
};

function coverage() {
  console.log("=== Abdeckung (Zeilen und Quoten, keine Ergebnisse) ===");
  console.log("Liga             Saisons     Spiele  Teams  Pinnacle 1X2  Marktmittel 1X2  Pinnacle Ü/U  Torschuesse");
  for (const league of LEAGUES) {
    const all = loadLeagueMatches(league.code).filter((m) => LEAGUE_SEASONS.includes(m.season));
    for (const [label, seasons] of [["Entwicklung", DEV], ["Holdout", LEAGUE_HOLDOUT_SEASONS]] as const) {
      const ms = all.filter((m) => seasons.includes(m.season));
      const teams = [...new Set(seasons.map((s) => teamsInSeason(all, s)))].join("/");
      console.log(
        `${league.name.padEnd(16)} ${label.padEnd(11)} ${String(ms.length).padStart(6)}  ${teams.padStart(5)}   ` +
          `${pct(ms.filter((m) => m.closeOddsHome).length, ms.length).padStart(10)}  ${pct(ms.filter((m) => m.avgCloseOddsHome).length, ms.length).padStart(14)}  ` +
          `${pct(ms.filter((m) => m.closeOddsOver25).length, ms.length).padStart(11)}  ${pct(ms.filter((m) => m.shotsOnTargetHome !== undefined).length, ms.length).padStart(10)}`
      );
    }
  }
  console.log(`Messlatte der Entwicklung: ${BENCHMARK_LABELS[LEAGUE_BENCHMARK]}. Pinnacle-Ü/U steht erst ab 2019/20 in den Dateien.\n`);
}

// Die Recherche vom 19.11. (Einmal-Skripte, RECHERCHE.md Abschnitt 2) als Referenz: LogLoss
// auf dem exakten Ergebnis im Basismodell (ohne Form, ohne Temperatur, ρ −0,15) je Liga,
// 2016/17 bis 2022/23. Kleine Abweichungen sind erwartet: die Recherche schnitt die Bloecke
// nach Anstosszeit und bewertete auch Spiele ohne Quote, der Repo-Weg schneidet nach
// Kalendertag und bewertet nur Spiele mit Pinnacle-Schlussquote.
const RESEARCH_CS: Record<LeagueCode, number> = { D1: 3.0442, E0: 2.9281, SP1: 2.8294, I1: 2.9165, F1: 2.8836 };

function report(label: string, p: { perLeague: Map<LeagueCode, BootstrapResult>; pooled: BootstrapResult }) {
  const cells = LEAGUES.map((l) => ci(p.perLeague.get(l.code)!));
  console.log(`  ${label.padEnd(20)} ${cells.map((c) => c.padEnd(31)).join("")}${ci(p.pooled)}`);
}

function header(title: string) {
  console.log(`  ${title.padEnd(20)} ${LEAGUES.map((l) => l.name.padEnd(31)).join("")}alle fuenf`);
}

coverage();

const t0 = Date.now();
const prod = new Map<LeagueCode, MatchEvaluation[]>();
const base = new Map<LeagueCode, MatchEvaluation[]>();
const market = new Map<LeagueCode, MatchEvaluation[]>();
const prodContexts = new Map<LeagueCode, ReturnType<typeof leagueWalkForward>>();
for (const league of LEAGUES) {
  const ctx = leagueWalkForward(league.code, DEV, PRODUCTION_MODEL_OPTIONS);
  prodContexts.set(league.code, ctx);
  prod.set(league.code, evaluateRun(ctx, PROD));
  base.set(league.code, evaluateRun(ctx, BASE));
  market.set(league.code, evaluateRun(ctx, MARKT));
}
console.log(`Walk-forward je Liga in ${((Date.now() - t0) / 1000).toFixed(0)} s, ${[...prod.values()].reduce((s, e) => s + e.length, 0)} Spiele mit Quote.\n`);

console.log("=== Abgleich mit RECHERCHE.md (Basismodell, LogLoss exaktes Ergebnis) ===");
for (const league of LEAGUES) {
  const ev = base.get(league.code)!;
  const cs = mean(ev.map((e) => e.metrics.scoreLogLoss!));
  console.log(`  ${league.name.padEnd(16)} Repo ${cs.toFixed(4)} (n = ${ev.length})   Recherche ${RESEARCH_CS[league.code].toFixed(4)}   Abstand ${f4(cs - RESEARCH_CS[league.code])}`);
}

console.log(`\n=== Ausgangsstand: Produktion gegen Markt, Entwicklung ${DEV[0]}–${DEV[DEV.length - 1]} (positiv = Markt besser) ===`);
console.log("  Ausserhalb der Bundesliga: Form aus Torschuessen statt xG, sonst die produktive Einstellung.");
header("Kennzahl");
report("1X2 RPS", pairedByLeague(prod, market, PICK.rps));
report("1X2 LogLoss", pairedByLeague(prod, market, PICK.ll));
report("Ü/U 2,5 LogLoss", pairedByLeague(prod, market, PICK.ou));

if (flag("kandidat")) {
  const cand = new Map<LeagueCode, MatchEvaluation[]>();
  for (const league of LEAGUES) cand.set(league.code, evaluateRun(leagueWalkForward(league.code, DEV, candidateModelOptions()), CAND));
  console.log(`\n=== Kandidat 2027/28 gegen Produktion, Entwicklung (positiv = Kandidat besser; explorativ, keine Entscheidung) ===`);
  console.log("  Ausserhalb der Bundesliga ohne xG: der Blend-Fit rechnet dort mit Toren, die Form kommt aus Torschuessen.");
  header("Kennzahl");
  report("exaktes Ergebnis", pairedByLeague(prod, cand, PICK.cs));
  report("1X2 LogLoss", pairedByLeague(prod, cand, PICK.ll));
  report("1X2 RPS", pairedByLeague(prod, cand, PICK.rps));
  report("Ü/U 2,5 LogLoss", pairedByLeague(prod, cand, PICK.ou));
  console.log("\n  Rueckstand zum Markt, Kandidat (positiv = Markt besser):");
  header("Kennzahl");
  report("1X2 LogLoss", pairedByLeague(cand, market, PICK.ll));
  report("Ü/U 2,5 LogLoss", pairedByLeague(cand, market, PICK.ou));
}
