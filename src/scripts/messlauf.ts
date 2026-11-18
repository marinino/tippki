// Messlauf zu den eingefrorenen Punkten 1, 6, 15 und 18 (MESSLAUF.md).
//
//   npm run messlauf
//
// Der Plan -- Varianten, Kennzahlen, Entscheidungsregel, Konsistenzpruefungen -- steht in
// MESSLAUF.md und wurde VOR dem ersten Lauf festgelegt. Dieses Skript setzt genau ihn um.
// Wer eine weitere Variante sehen will, schreibt sie zuerst dort als neuen Plan auf.
//
// Nur Auswertung: es aendert nichts an der Vorhersage, und es rechnet ausschliesslich auf
// VALIDATION_SEASONS. Test (2023-2025) und die laufende Saison bleiben unberuehrt.
//
// Technik: alle Formvarianten sind ausgetauschte Formwerte in denselben Walk-forward-
// Kontexten. Die Produktion rechnet λ × exp(0,2 × Form); eine Klammer von ±c auf dem
// Exponenten ist also eine Klammer von ±c/0,2 auf der Form, die geteilte Form ist
// Angriff_eigen + Abwehr_Gegner an der Stelle der Form. Der Backtest-Kern bleibt
// unveraendert, und der Bezug laeuft durch exakt denselben Pfad wie jede Variante.

import { readFileSync } from "fs";
import { join } from "path";
import { loadAllMatches, parseMatchDate, type Match } from "../data/loadMatches";
import {
  PRODUCTION_MODEL_OPTIONS,
  buildLeagueModel,
  type LeagueModelOptions,
  type TeamStrength,
} from "../model/teamStrength";
import { XG_FORM_WEIGHT, XG_FORM_WINDOW } from "../model/xgForm";
import { lookupMatchXg } from "../model/xgLookup";
import {
  buildWalkForwardContexts,
  evaluateRun,
  type MatchEvaluation,
  type PredictionContext,
  type SeasonContexts,
} from "../eval/backtestCore";
import { pairedBootstrap } from "../eval/significance";
import { VALIDATION_SEASONS } from "../eval/splits";
import { configHash } from "../model/pipelineConfig";

const seasons = VALIDATION_SEASONS;
const allMatches = loadAllMatches();
const SPEC = { name: "modell", variant: "model" as const };

console.log(`Messlauf (MESSLAUF.md) auf Validation: ${seasons.join(", ")}`);
console.log(`configHash ${configHash()}, Formgewicht ${XG_FORM_WEIGHT}, Fenster ${XG_FORM_WINDOW}\n`);

// ---------------------------------------------------------------------------
// Kontexte

const baseline = buildWalkForwardContexts(seasons, PRODUCTION_MODEL_OPTIONS, allMatches);

// Formfenster aus den Kontexten der Saison: die letzten bis zu 3 eigenen Spiele dieser
// Saison, strikt vor Anpfiff -- dieselbe Definition wie computeXgForm. Konsistenzpruefung 2
// vergleicht xG − xGA daraus mit der rohen Form, die die Produktion rechnet.
interface Window {
  xgFor: number;
  xgAgainst: number;
  vsExpectation: number;
  // Pruefgroesse: mittleres (xG − xGA), muss der rohen Form entsprechen.
  rawCheck: number;
  complete: boolean;
}

function teamWindows(season: SeasonContexts): Map<PredictionContext, { home: Window; away: Window }> {
  const sorted = [...season.contexts].sort(
    (a, b) => parseMatchDate(a.date).getTime() - parseMatchDate(b.date).getTime()
  );
  const history = new Map<string, PredictionContext[]>();
  const result = new Map<PredictionContext, { home: Window; away: Window }>();

  const windowOf = (team: string, before: number): Window => {
    const games = (history.get(team) ?? []).filter((g) => parseMatchDate(g.date).getTime() < before);
    const recent = games.slice(-XG_FORM_WINDOW);
    let xgFor = 0;
    let xgAgainst = 0;
    let vsExp = 0;
    let complete = true;
    for (const g of recent) {
      const xg = lookupMatchXg(g.homeTeam, g.awayTeam, parseMatchDate(g.date));
      if (!xg) {
        complete = false;
        continue;
      }
      const isHome = g.homeTeam === team;
      const own = isHome ? xg.homeXG : xg.awayXG;
      const opp = isHome ? xg.awayXG : xg.homeXG;
      const expOwn = isHome ? g.baseLambdaHome : g.baseLambdaAway;
      const expOpp = isHome ? g.baseLambdaAway : g.baseLambdaHome;
      xgFor += own;
      xgAgainst += opp;
      vsExp += own - opp - (expOwn - expOpp);
    }
    const n = recent.length;
    return n === 0
      ? { xgFor: 0, xgAgainst: 0, vsExpectation: 0, rawCheck: 0, complete: true }
      : { xgFor: xgFor / n, xgAgainst: xgAgainst / n, vsExpectation: vsExp / n, rawCheck: (xgFor - xgAgainst) / n, complete };
  };

  // Erst die ganze Saison je Team einsortieren, dann jedes Fenster ueber den strikten
  // Zeitfilter bilden -- so sieht kein Spiel sich selbst oder etwas Spaeteres.
  for (const ctx of sorted) {
    for (const team of [ctx.homeTeam, ctx.awayTeam]) {
      const list = history.get(team) ?? [];
      list.push(ctx);
      history.set(team, list);
    }
  }
  for (const ctx of sorted) {
    const t = parseMatchDate(ctx.date).getTime();
    result.set(ctx, { home: windowOf(ctx.homeTeam, t), away: windowOf(ctx.awayTeam, t) });
  }
  return result;
}

// μ: mittleres xG je Team und Spiel ueber alle xG-Spiele vor Saisonbeginn.
const xgRows: { date: string; homeXG: number; awayXG: number }[] = JSON.parse(
  readFileSync(join(process.cwd(), "data", "xg_bundesliga.json"), "utf-8")
);
function leagueXgMean(season: SeasonContexts): number {
  const start = Math.min(...season.contexts.map((c) => parseMatchDate(c.date).getTime()));
  let sum = 0;
  let n = 0;
  for (const r of xgRows) {
    if (new Date(r.date).getTime() >= start) continue;
    sum += r.homeXG + r.awayXG;
    n += 2;
  }
  return sum / n;
}

const windows = new Map<PredictionContext, { home: Window; away: Window }>();
const mu = new Map<string, number>();
for (const s of baseline) {
  for (const [ctx, w] of teamWindows(s)) windows.set(ctx, w);
  mu.set(s.season, leagueXgMean(s));
}

// Variante = neue Formwerte je Kontext, sonst alles gleich.
function withForm(
  contexts: SeasonContexts[],
  form: (ctx: PredictionContext, w: { home: Window; away: Window }, mu: number) => [number, number]
): SeasonContexts[] {
  return contexts.map((s) => ({
    ...s,
    contexts: s.contexts.map((ctx) => {
      const [homeForm, awayForm] = form(ctx, windows.get(ctx)!, mu.get(s.season)!);
      return { ...ctx, homeForm, awayForm };
    }),
  }));
}

const clampForm = (c: number) => (f: number) => Math.max(-c / XG_FORM_WEIGHT, Math.min(c / XG_FORM_WEIGHT, f));
const clamp15 = clampForm(0.15);
const clamp25 = clampForm(0.25);

// D1: Rueckkehrer je Saison, und ein Modellbau, der sie zum Aufsteiger-Niveau zieht.
const seasonsOf = (team: string) => new Set(allMatches.filter((m) => m.homeTeam === team || m.awayTeam === team).map((m) => m.season));
function returnersOf(season: string): string[] {
  const prev = String(Number(season) - 1);
  const teams = [...new Set(allMatches.filter((m) => m.season === season).flatMap((m) => [m.homeTeam, m.awayTeam]))];
  return teams.filter((t) => {
    const s = seasonsOf(t);
    return !s.has(prev) && [...s].some((x) => x < prev);
  }).sort();
}

function returnerModel(returners: string[], target: "default" | "zero") {
  return (matches: Match[], options: LeagueModelOptions) => {
    const base = buildLeagueModel(matches, options);
    const targets = new Map<string, TeamStrength>();
    for (const t of returners) {
      if (!base.teams.has(t)) continue;
      targets.set(t, target === "default" ? base.promotedTeamDefault : { attack: 0, defense: 0 });
    }
    return targets.size > 0 ? buildLeagueModel(matches, { ...options, ridgeTargets: targets }) : base;
  };
}

const returners = new Map(seasons.map((s) => [s, returnersOf(s)]));
const d1Contexts = seasons.flatMap((s) =>
  buildWalkForwardContexts([s], PRODUCTION_MODEL_OPTIONS, allMatches, returnerModel(returners.get(s)!, "default"))
);

// ---------------------------------------------------------------------------
// Konsistenzpruefungen (MESSLAUF.md) -- vor jedem Ergebnis.

const sameNumbers = (a: MatchEvaluation[], b: MatchEvaluation[]) =>
  a.length === b.length &&
  a.every((e, i) => JSON.stringify(e.probs) === JSON.stringify(b[i].probs) && e.metrics.scoreLogLoss === b[i].metrics.scoreLogLoss);

const baseEval = evaluateRun(baseline, SPEC);
const identity = evaluateRun(withForm(baseline, (c) => [c.homeForm, c.awayForm]), SPEC);
const check1 = sameNumbers(baseEval, identity);

let windowMismatch = 0;
let windowIncomplete = 0;
let windowCount = 0;
for (const s of baseline) {
  for (const ctx of s.contexts) {
    const w = windows.get(ctx)!;
    for (const [win, form] of [[w.home, ctx.homeForm], [w.away, ctx.awayForm]] as const) {
      windowCount++;
      if (!win.complete) windowIncomplete++;
      if (Math.abs(win.rawCheck - form) > 1e-9) windowMismatch++;
    }
  }
}
const check2 = windowMismatch / windowCount < 0.01;

const zeroTargets = seasons.flatMap((s) =>
  buildWalkForwardContexts([s], PRODUCTION_MODEL_OPTIONS, allMatches, returnerModel(returners.get(s)!, "zero"))
);
const check3 = sameNumbers(baseEval, evaluateRun(zeroTargets, SPEC));

console.log("Konsistenzpruefungen");
console.log(`  1. Bezug ueber den Variantenpfad bitgleich mit evaluateRun:      ${check1 ? "ja" : "NEIN"}`);
console.log(
  `  2. Formfenster == computeXgForm:  ${windowCount - windowMismatch} von ${windowCount} gleich ` +
    `(${windowMismatch} abweichend, ${windowIncomplete} Fenster mit fehlendem xG)  ${check2 ? "ok" : "NICHT OK"}`
);
console.log(`  3. Rueckkehrer-Ziel 0 bitgleich mit dem Bezug (Option ist inert):  ${check3 ? "ja" : "NEIN"}`);
console.log(`  4. Spieltag 10 vor/nach der Fit-Option bitgleich, Hash ${configHash()}: separat geprueft\n`);
if (!check1 || !check2 || !check3) {
  console.log("Eine Konsistenzpruefung ist fehlgeschlagen -- der Lauf zaehlt nicht. Abbruch.");
  process.exit(1);
}

console.log("Rueckkehrer je Saison (D1):");
for (const s of seasons) console.log(`  ${s}: ${returners.get(s)!.join(", ") || "keine"}`);
console.log("");

// ---------------------------------------------------------------------------
// Varianten und Kennzahlen

interface Candidate {
  id: string;
  label: string;
  evals: MatchEvaluation[];
  primary: "rps" | "ou";
}

const candidates: Candidate[] = [
  { id: "A1", label: "Form als Residuum", primary: "rps", evals: evaluateRun(withForm(baseline, (c) => [c.homeFormResidual, c.awayFormResidual]), SPEC) },
  { id: "A2", label: "Form gegen Erwartung", primary: "rps", evals: evaluateRun(withForm(baseline, (_, w) => [w.home.vsExpectation, w.away.vsExpectation]), SPEC) },
  { id: "B1", label: "Klammer ±0,15", primary: "rps", evals: evaluateRun(withForm(baseline, (c) => [clamp15(c.homeForm), clamp15(c.awayForm)]), SPEC) },
  { id: "B2", label: "Klammer ±0,25", primary: "rps", evals: evaluateRun(withForm(baseline, (c) => [clamp25(c.homeForm), clamp25(c.awayForm)]), SPEC) },
];
const split = evaluateRun(
  withForm(baseline, (_, w, m) => [
    w.home.xgFor - m + (w.away.xgAgainst - m),
    w.away.xgFor - m + (w.home.xgAgainst - m),
  ]),
  SPEC
);
candidates.push({ id: "C1", label: "geteilte Form", primary: "rps", evals: split });
candidates.push({ id: "C1-OU", label: "geteilte Form (Ü/U 2,5)", primary: "ou", evals: split });
candidates.push({ id: "D1", label: "Rueckkehrer zum Aufsteiger-Niveau", primary: "rps", evals: evaluateRun(d1Contexts, SPEC) });

type Pick = (e: MatchEvaluation) => number | null;
const PICK: Record<string, Pick> = {
  rps: (e) => e.metrics.rps,
  logloss: (e) => e.metrics.logLoss,
  ou: (e) => e.metrics.totals?.logLoss ?? null,
  score: (e) => e.metrics.scoreLogLoss,
};

function paired(cand: MatchEvaluation[], pick: Pick, base = baseEval) {
  if (cand.length !== base.length) throw new Error("ungepaart: verschiedene Spielmengen");
  const diffs: number[] = [];
  for (let i = 0; i < base.length; i++) {
    if (base[i].date !== cand[i].date || base[i].homeTeam !== cand[i].homeTeam) throw new Error("ungepaart: Reihenfolge");
    const a = pick(base[i]);
    const b = pick(cand[i]);
    if (a === null || b === null) continue;
    diffs.push(a - b);
  }
  return pairedBootstrap(diffs);
}

const rows = candidates.map((c) => ({
  c,
  primary: paired(c.evals, PICK[c.primary]),
  logloss: paired(c.evals, PICK.logloss),
  ou: paired(c.evals, PICK.ou),
  score: paired(c.evals, PICK.score),
}));

// Holm ueber die sieben primaeren Tests.
const order = rows.map((r, i) => ({ i, p: r.primary.pValue })).sort((a, b) => a.p - b.p);
const holm = new Array<number>(rows.length);
let running = 0;
order.forEach(({ i, p }, k) => {
  running = Math.max(running, Math.min(1, (rows.length - k) * p));
  holm[i] = running;
});

const mean = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.reduce((s, x) => s + x, 0) / v.length;
};
const f4 = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(4)}`;

console.log(`Bezug (produktiv): RPS ${mean(baseEval.map(PICK.rps)).toFixed(4)}, LogLoss ${mean(baseEval.map(PICK.logloss)).toFixed(4)}, ` +
  `Ü/U ${mean(baseEval.map(PICK.ou)).toFixed(4)}, Ergebnis ${mean(baseEval.map(PICK.score)).toFixed(4)}  (n = ${baseEval.length})\n`);
console.log("Δ = Bezug − Kandidat, positiv = Kandidat besser. Primaer: RPS (C1-OU: Ü/U-LogLoss).\n");
console.log("Kandidat  primaer   Δ primaer [95%-KI]               p      Holm-p   ΔLogLoss (p)       ΔÜ/U (p)           ΔErgebnis   Urteil");
console.log("-".repeat(140));
rows.forEach((r, i) => {
  const qualifies = r.primary.meanDiff > 0 && holm[i] < 0.05 && !(r.logloss.meanDiff < 0 && r.logloss.pValue < 0.05);
  console.log(
    `${r.c.id.padEnd(9)} ${(r.c.primary === "rps" ? "RPS" : "Ü/U").padEnd(8)} ` +
      `${f4(r.primary.meanDiff)} [${f4(r.primary.ciLow)}, ${f4(r.primary.ciHigh)}]   ` +
      `${r.primary.pValue.toFixed(4)}  ${holm[i].toFixed(4)}   ` +
      `${f4(r.logloss.meanDiff)} (${r.logloss.pValue.toFixed(3)})   ${f4(r.ou.meanDiff)} (${r.ou.pValue.toFixed(3)})   ` +
      `${f4(r.score.meanDiff)}     ${qualifies ? "KANDIDAT" : "kein Nachweis"}`
  );
});

// Beschreibend, ohne Entscheidungskraft: wo D1 ueberhaupt wirkt.
console.log("\nBeschreibend: D1 nur auf Spielen mit Rueckkehrer-Beteiligung");
const d1 = candidates.find((c) => c.id === "D1")!.evals;
for (const early of [true, false]) {
  const idx: number[] = [];
  baseEval.forEach((e, i) => {
    const r = returners.get(e.season)!;
    if (!r.includes(e.homeTeam) && !r.includes(e.awayTeam)) return;
    const seasonStart = Math.min(...baseEval.filter((x) => x.season === e.season).map((x) => parseMatchDate(x.date).getTime()));
    const days = (parseMatchDate(e.date).getTime() - seasonStart) / 86400000;
    if (early && days > 70) return;
    idx.push(i);
  });
  const b = pairedBootstrap(idx.map((i) => baseEval[i].metrics.rps - d1[i].metrics.rps));
  console.log(`  ${early ? "erste ~10 Wochen" : "ganze Saison   "}: n = ${b.n}, ΔRPS ${f4(b.meanDiff)} [${f4(b.ciLow)}, ${f4(b.ciHigh)}], p = ${b.pValue.toFixed(3)}`);
}
