// Was bringt die Formkurve wirklich?
//
//   npm run form
//
// Vier Fragen, in dieser Reihenfolge:
//
//   1. Misst die Formkurve ueberhaupt Form -- oder misst sie Teamstaerke ein zweites Mal?
//      computeXgForm liefert die mittlere xG-Differenz der letzten Spiele. Bayern hat die
//      fast immer positiv, unabhaengig von der Tagesform. Falls die Formwerte mit der
//      Teamstaerke korrelieren, wird Staerke doppelt gezaehlt: einmal ueber attack/defense
//      und einmal ueber die "Form".
//
//   2. Wie viel Formgewicht ist optimal -- auf der 1X2-Verteilung und auf der Form der
//      Ergebnismatrix? Die beiden koennen auseinanderlaufen: ein Formgewicht kann die
//      Tendenz schaerfen und gleichzeitig das Torniveau verfehlen.
//
//   3. Wirkt Form spaeter in der Saison staerker? Am ersten Spieltag ist sie
//      konstruktionsbedingt 0 und faehrt dann hoch.
//
//   4. Wo bringt die Form uns vom Markt weg -- und wer hat dann recht?

import { loadAllMatches, parseMatchDate } from "../data/loadMatches";
import { computeXgForm } from "../model/xgForm";
import { PRODUCTION_MODEL_OPTIONS, buildLeagueModel } from "../model/teamStrength";
import { summarize, type OutcomeProbs, type PerMatchMetrics } from "../eval/metrics";
import { pairedBootstrap } from "../eval/significance";
import { seasonsFor, VALIDATION_SEASONS } from "../eval/splits";
import {
  buildContexts,
  buildWalkForwardContexts,
  evaluateRun,
  type MatchEvaluation,
  type RunSpec,
} from "../eval/backtestCore";

const seasons = seasonsFor("validation");
const contexts = buildContexts(seasons);

// ---------------------------------------------------------------------------
console.log("=== 1. Misst die Formkurve Form oder Teamstaerke? ===\n");

// Pro Team: mittlere Formkurve ueber alle Spiele, gegen die Modell-Teamstaerke.
// Waere die Formkurve reine Tagesform, muesste ihr Mittelwert je Team nahe 0 liegen.
const allMatches = loadAllMatches();
const trainMatches = allMatches.filter((m) => m.season < VALIDATION_SEASONS[0]);
const model = buildLeagueModel(trainMatches, PRODUCTION_MODEL_OPTIONS);

const formByTeam = new Map<string, number[]>();
for (const season of contexts) {
  for (const ctx of season.contexts) {
    for (const [team, form] of [
      [ctx.homeTeam, ctx.homeForm],
      [ctx.awayTeam, ctx.awayForm],
    ] as [string, number][]) {
      const list = formByTeam.get(team);
      if (list) list.push(form);
      else formByTeam.set(team, [form]);
    }
  }
}

interface TeamRow {
  team: string;
  meanForm: number;
  strength: number;
  n: number;
}

const rows: TeamRow[] = [];
for (const [team, forms] of formByTeam) {
  const strength = model.teams.get(team);
  if (!strength || forms.length < 30) continue;
  rows.push({
    team,
    meanForm: forms.reduce((s, f) => s + f, 0) / forms.length,
    strength: strength.attack - strength.defense,
    n: forms.length,
  });
}

function correlation(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}

rows.sort((a, b) => b.meanForm - a.meanForm);
console.log("Team                  mittlere Form   Teamstaerke (att-def)");
for (const r of rows.slice(0, 6)) {
  console.log(
    `${r.team.padEnd(20)} ${r.meanForm >= 0 ? "+" : ""}${r.meanForm.toFixed(3).padStart(7)}        ${r.strength >= 0 ? "+" : ""}${r.strength.toFixed(3)}`
  );
}
console.log("   ...");
for (const r of rows.slice(-4)) {
  console.log(
    `${r.team.padEnd(20)} ${r.meanForm >= 0 ? "+" : ""}${r.meanForm.toFixed(3).padStart(7)}        ${r.strength >= 0 ? "+" : ""}${r.strength.toFixed(3)}`
  );
}

const corr = correlation(
  rows.map((r) => r.meanForm),
  rows.map((r) => r.strength)
);
const meanAbs = rows.reduce((s, r) => s + Math.abs(r.meanForm), 0) / rows.length;

console.log(
  `\nKorrelation zwischen mittlerer Formkurve und Teamstaerke: r = ${corr.toFixed(3)} (${rows.length} Teams)`
);
console.log(`Mittlerer Betrag der Team-Formkurve: ${meanAbs.toFixed(3)}`);
console.log(
  corr > 0.5
    ? "\n=> Die Formkurve ist ueberwiegend Teamstaerke, nicht Tagesform. Sie wird damit\n" +
        "   doppelt gezaehlt: einmal ueber attack/defense, einmal ueber exp(w * Form).\n" +
        "   Ein starkes Team bekommt dauerhaft einen Bonus, den es nicht verdient hat."
    : "\n=> Die Formkurve ist weitgehend unabhaengig von der Teamstaerke."
);

// ---------------------------------------------------------------------------
console.log("\n\n=== 2. Optimales Formgewicht ===\n");

const WEIGHTS = [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.6];

interface Setup {
  label: string;
  spec: (w: number) => RunSpec;
}

const setups: Setup[] = [
  {
    label: "rohe xG-Differenz",
    spec: (w) => ({ name: "m", variant: "model", xgFormWeight: w }),
  },
  {
    label: "Abweichung vom Normalniveau",
    spec: (w) => ({ name: "m", variant: "model", xgFormWeight: w, formMode: "residual" }),
  },
];

for (const setup of setups) {
  console.log(`--- ${setup.label} ---`);
  console.log("Gewicht    RPS      O/U 2.5    Score    ΔRPS vs w=0    p");

  const zeroEval = evaluateRun(contexts, setup.spec(0));

  for (const w of WEIGHTS) {
    const evaluations = evaluateRun(contexts, setup.spec(w));
    const summary = summarize(evaluations.map((e) => e.metrics));
    const diffs = evaluations.map((e, i) => zeroEval[i].metrics.rps - e.metrics.rps);
    const test = pairedBootstrap(diffs, { iterations: 3000 });
    const mark = w === 0.2 ? " <- aktuell" : "";
    console.log(
      `  ${w.toFixed(2)}    ${summary.rps.toFixed(4)}  ${summary.totalsLogLoss.toFixed(4)}  ` +
        `${summary.scoreLogLoss.toFixed(4)}   ` +
        `${test.meanDiff >= 0 ? "+" : ""}${test.meanDiff.toFixed(4)}       ${test.pValue.toFixed(3)}${mark}`
    );
  }
  console.log("");
}

// ---------------------------------------------------------------------------
console.log("\n=== 3. Wirkt Form spaeter in der Saison staerker? ===\n");

// Spieltag aus dem Datum rekonstruieren: die Spiele einer Saison chronologisch in
// Bloecke zu 9 teilen. Das ist naeherungsweise der Spieltag und reicht fuer die Frage,
// ob Form frueh oder spaet in der Saison mehr traegt.
const withForm: RunSpec = { name: "m", variant: "model" };
const withoutForm: RunSpec = { ...withForm, xgFormWeight: 0 };

const evalForm = evaluateRun(contexts, withForm);
const evalNone = evaluateRun(contexts, withoutForm);

const matchdayOf = new Map<string, number>();
for (const season of seasons) {
  const seasonMatches = allMatches
    .filter((m) => m.season === season)
    .sort((a, b) => parseMatchDate(a.date).getTime() - parseMatchDate(b.date).getTime());
  seasonMatches.forEach((m, i) => {
    matchdayOf.set(`${m.season}|${m.homeTeam}|${m.awayTeam}`, Math.floor(i / 9) + 1);
  });
}

const buckets: { label: string; from: number; to: number }[] = [
  { label: "Spieltag  1-6 ", from: 1, to: 6 },
  { label: "Spieltag  7-17", from: 7, to: 17 },
  { label: "Spieltag 18-28", from: 18, to: 28 },
  { label: "Spieltag 29-34", from: 29, to: 34 },
];

console.log("Phase             n     RPS mit Form   RPS ohne Form   Δ RPS              p");
for (const bucket of buckets) {
  const withRows: PerMatchMetrics[] = [];
  const withoutRows: PerMatchMetrics[] = [];
  const diffs: number[] = [];

  for (let i = 0; i < evalForm.length; i++) {
    const e = evalForm[i];
    const md = matchdayOf.get(`${e.season}|${e.homeTeam}|${e.awayTeam}`);
    if (md === undefined || md < bucket.from || md > bucket.to) continue;
    withRows.push(e.metrics);
    withoutRows.push(evalNone[i].metrics);
    // Niedriger ist beim RPS besser, deshalb umgedreht: positiv = mit Form ist besser.
    diffs.push(evalNone[i].metrics.rps - e.metrics.rps);
  }

  const a = summarize(withRows);
  const b = summarize(withoutRows);
  const test = pairedBootstrap(diffs, { iterations: 3000 });
  console.log(
    `${bucket.label}   ${String(a.n).padStart(4)}   ${a.rps.toFixed(4).padStart(10)}   ` +
      `${b.rps.toFixed(4).padStart(13)}   ${(test.meanDiff >= 0 ? "+" : "") + test.meanDiff.toFixed(4)}`.padEnd(20) +
      `   ${test.pValue.toFixed(3)}`
  );
}

// ---------------------------------------------------------------------------
console.log("\n\n=== 4. Wo bringt die Form uns vom Markt weg -- und wer hat dann recht? ===\n");

// Anlass (18.11.2026): am Spieltag 10 wichen drei der neun haeufigsten Ergebnisse von denen
// bei Tipico ab, und alle drei nur wegen der Form (VERBESSERUNGEN.md, Punkt 6). Ein Spieltag
// ist eine Anekdote; hier steht dieselbe Frage ueber alle Validation-Spiele.
//
// Bewusst NICHT auf den Kontexten oben: walk-forward, weil "mitten in der Saison" genau die
// Lage ist, in der die Form wirkt, und Pinnacle-Schluss statt der Voreinstellung, weil er in
// der Validation alle Spiele abdeckt (das Marktmittel fehlt 2018 ganz) und der schaerfere
// Gegner ist. "deutlich uneinig" ist dieselbe Schwelle wie in benchmark.ts.
//
// Vorsicht beim Lesen: die Teilmengen sind nach der Meinung des Marktes geschnitten, und der
// Markt liegt im Mittel naeher am Ausgang als wir. "Durch die Form uneinig" verliert deshalb
// fast zwangslaeufig, "die Form holt uns zum Markt" gewinnt fast zwangslaeufig. Ob die Form
// insgesamt hilft, sagt nur die erste Zeile. Die Zerlegung zeigt, WO der Rueckstand sitzt.
const DISAGREEMENT = 0.12;
const wfContexts = buildWalkForwardContexts(seasons, PRODUCTION_MODEL_OPTIONS, allMatches, buildLeagueModel, "pinnacleClose");
const wfForm = evaluateRun(wfContexts, { name: "mit Form", variant: "model" });
const wfNone = evaluateRun(wfContexts, { name: "ohne Form", variant: "model", xgFormWeight: 0 });
const wfMarket = evaluateRun(wfContexts, { name: "Markt", variant: "benchmark" });
if (wfForm.length !== wfMarket.length || wfNone.length !== wfMarket.length) {
  throw new Error("Laeufe unterschiedlich lang -- gepaarter Vergleich unmoeglich");
}

function tvDistance(a: OutcomeProbs, b: OutcomeProbs): number {
  return (
    (Math.abs(a.homeWinProb - b.homeWinProb) +
      Math.abs(a.drawProb - b.drawProb) +
      Math.abs(a.awayWinProb - b.awayWinProb)) /
    2
  );
}
const favourite = (p: OutcomeProbs) => Math.max(p.homeWinProb, p.drawProb, p.awayWinProb);
const apartWith = wfForm.map((e, i) => tvDistance(e.probs, wfMarket[i].probs) >= DISAGREEMENT);
const apartWithout = wfNone.map((e, i) => tvDistance(e.probs, wfMarket[i].probs) >= DISAGREEMENT);
const totalGap = wfForm.reduce((s, e, i) => s + e.metrics.rps - wfMarket[i].metrics.rps, 0);

function gapRow(label: string, keep: (i: number) => boolean): void {
  const idx = wfForm.map((_, i) => i).filter(keep);
  if (idx.length === 0) {
    console.log(`${label.padEnd(36)}     0`);
    return;
  }
  const mean = (runs: MatchEvaluation[]) => idx.reduce((s, i) => s + runs[i].metrics.rps, 0) / idx.length;
  const signed = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(4)}`;
  const withForm = pairedBootstrap(idx.map((i) => wfMarket[i].metrics.rps - wfForm[i].metrics.rps), { iterations: 4000 });
  const share = idx.reduce((s, i) => s + wfForm[i].metrics.rps - wfMarket[i].metrics.rps, 0) / totalGap;
  const surer = idx.filter((i) => favourite(wfForm[i].probs) > favourite(wfMarket[i].probs)).length / idx.length;
  console.log(
    `${label.padEnd(36)} ${String(idx.length).padStart(5)}   ${mean(wfForm).toFixed(4)}   ${mean(wfNone).toFixed(4)}   ` +
      `${mean(wfMarket).toFixed(4)}   ${signed(withForm.meanDiff)}  ${withForm.pValue.toFixed(3)}   ` +
      `${`${(share * 100).toFixed(0)}%`.padStart(5)}   ${`${(surer * 100).toFixed(0)}%`.padStart(5)}`
  );
}

console.log(
  `Walk-forward, Pinnacle-Schluss, ${wfForm.length} Spiele. Abstand positiv = Modell mit Form besser.\n`
);
console.log("Teilmenge                                n   RPS Form  ohne Form  Markt    Abstand    p     Anteil  sicherer");
console.log("".padEnd(110, "-"));
gapRow("alle Spiele", () => true);
gapRow("einig (< 12pp)", (i) => !apartWith[i]);
gapRow("deutlich uneinig (>= 12pp)", (i) => apartWith[i]);
gapRow("  ... ohne Form waeren wir einig", (i) => apartWith[i] && !apartWithout[i]);
gapRow("  ... auch ohne Form uneinig", (i) => apartWith[i] && apartWithout[i]);
gapRow("die Form holt uns zum Markt", (i) => !apartWith[i] && apartWithout[i]);
console.log(
  `\nAnteil = Anteil am gesamten RPS-Rueckstand auf den Markt. sicherer = das Modell traut\n` +
    `seinem Favoriten mehr zu als der Markt. Liegt der Rueckstand in "ohne Form waeren wir\n` +
    `einig" und ist das Modell dort meist sicherer, uebertreibt die Form. Holt sie uns\n` +
    `gleichzeitig in "die Form holt uns zum Markt" heran, steckt in ihr auch Information --\n` +
    `dann ist eine Begrenzung die Frage, nicht das Weglassen.`
);
