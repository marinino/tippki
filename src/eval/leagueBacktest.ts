// Walk-forward ueber die fuenf Ligen der Mehrliga-Messbasis (src/data/leagues.ts).
//
// Derselbe Backtest-Kern wie fuer die Bundesliga (buildWalkForwardContexts, evaluateRun), mit
// drei Unterschieden, die je Liga noetig sind:
//
//   1. Blockgroesse: neu gefittet wird vor jedem Spieltag, und ein Spieltag hat in einer
//      20er-Liga 10 Spiele, nicht 9. Je Saison bestimmt, weil Ligue 1 ab 2023/24 mit 18
//      Mannschaften spielt.
//   2. Form: die vier anderen Ligen haben keine xG-Daten. Sie bekommen einen Ersatz aus
//      Torschuessen aufs Tor (shotsOnTargetFormProvider), umgerechnet auf die Skala von xG,
//      damit das produktive Formgewicht 0,2 dort dasselbe bedeutet. Die Bundesliga behaelt
//      die xG-Form, bitgleich mit dem produktiven Weg.
//   3. Messlatte: die Pinnacle-Schlussquote. Das Marktmittel (DEFAULT_BENCHMARK) steht in den
//      Dateien erst ab 2019/20, Pinnacle in allen Entwicklungssaisons.
//
// Und eine Sperre, die es fuer die Bundesliga-Validation nie gab: welche Saisons angefasst
// werden duerfen, steht unten, und die Holdout-Saisons lassen sich nur mit dem Namen eines
// vorab festgelegten Messplans oeffnen (MESSLAUF.md, Abschnitt "Mehrliga-Messbasis").

import { parseMatchDate, type Match } from "../data/loadMatches";
import { loadLeagueMatches, matchesPerRound, type LeagueCode } from "../data/leagues";
import { buildLeagueModel, type LeagueModel, type LeagueModelOptions } from "../model/teamStrength";
import { XG_FORM_WINDOW } from "../model/xgForm";
import {
  XG_FORM_PROVIDER,
  buildWalkForwardContexts,
  type FormProvider,
  type MatchEvaluation,
  type SeasonContexts,
} from "./backtestCore";
import type { BenchmarkSource } from "./benchmarkOdds";
import { pairedBootstrap, type BootstrapResult } from "./significance";

// Entwicklung: hier darf gemessen, verglichen und gewaehlt werden. 2014/15 und 2015/16 sind
// Anlauf (das Modell braucht Vorsaisons) und werden nie bewertet.
export const LEAGUE_DEVELOPMENT_SEASONS = ["2016", "2017", "2018", "2019", "2020", "2021", "2022"];

// Unberuehrt, in allen fuenf Ligen. In der Bundesliga sind das die Testsaisons, die Messplan 2
// im Sommer 2027 genau einmal braucht (der laeuft ueber src/scripts/candidate.ts, nicht hierueber).
// In den vier anderen Ligen sind sie die Bestaetigung fuer alles, was auf der Entwicklung
// gefunden wird -- und nur einmal je Frage brauchbar.
export const LEAGUE_HOLDOUT_SEASONS = ["2023", "2024", "2025"];

export const LEAGUE_BENCHMARK: BenchmarkSource = "pinnacleClose";

export interface LeagueRunOptions {
  buildModel?: (matches: Match[], options: LeagueModelOptions) => LeagueModel;
  benchmark?: BenchmarkSource;
  // Name eines vorab festgelegten Messplans aus MESSLAUF.md. Nur damit oeffnen sich die
  // Holdout-Saisons, und der Name wird laut ausgegeben, damit jeder Lauf zuzuordnen bleibt.
  holdoutPlan?: string;
}

// Wirft, wenn eine Saison weder Entwicklung noch (mit Messplan) Holdout ist. Exportiert, damit
// Skripte die Pruefung vor teurer Arbeit machen koennen.
export function assertLeagueSeasons(code: LeagueCode, seasons: string[], holdoutPlan?: string): void {
  const foreign = seasons.filter((s) => !LEAGUE_DEVELOPMENT_SEASONS.includes(s) && !LEAGUE_HOLDOUT_SEASONS.includes(s));
  if (foreign.length > 0) {
    throw new Error(
      `Mehrliga-Messbasis, ${code}: Saison ${foreign.join(", ")} ist weder Entwicklung (2016-2022) noch Holdout ` +
        `(2023-2025). 2014 und 2015 sind Anlauf, 2026 ist die Vorwaertssaison.`
    );
  }
  const holdout = seasons.filter((s) => LEAGUE_HOLDOUT_SEASONS.includes(s));
  if (holdout.length > 0 && !holdoutPlan) {
    throw new Error(
      `Mehrliga-Messbasis, ${code}: ${holdout.join(", ")} gehoert zum Holdout. Der oeffnet sich nur mit einem ` +
        `vorab festgelegten Messplan (holdoutPlan, MESSLAUF.md "Mehrliga-Messbasis").`
    );
  }
}

// Tore je Torschuss aufs Tor in einer Spielmenge, ohne Spiele ohne Torschusszahlen. null, wenn
// es keine gibt.
function goalsPerShotOnTarget(matches: Match[]): number | null {
  let goals = 0;
  let shots = 0;
  for (const m of matches) {
    if (m.shotsOnTargetHome === undefined || m.shotsOnTargetAway === undefined) continue;
    goals += m.homeGoals + m.awayGoals;
    shots += m.shotsOnTargetHome + m.shotsOnTargetAway;
  }
  return shots > 0 ? goals / shots : null;
}

// Formersatz aus Torschuessen fuer Ligen ohne xG: je Spiel (Torschuesse aufs Tor fuer −
// gegen) mal Tore je Torschuss aufs Tor in allen Spielen der Liga VOR dieser Saison. So liegt
// der Wert auf der Skala von Toren wie die xG-Differenz, und das produktive Gewicht 0,2 wirkt
// in derselben Groessenordnung.
//
// Fenster wie computeXgForm: die letzten bis zu XG_FORM_WINDOW Spiele DIESER Saison, strikt
// vor dem Anpfifftag, am Saisonanfang hochfahrend (0 vor dem ersten Spiel). Spiele ohne
// Torschusszahlen zaehlen nicht. Keine Residuum-Variante: residual ist hier immer 0.
//
// Warum Torschuesse: in den Top-5-Ligen tragen sie die Forminformation, nicht Punkte oder
// Tore (RECHERCHE.md, Abschnitt 4: gemeinsam gerechnet +0,060 je Standardabweichung, Punkte
// und Tordifferenz danach nichts mehr).
export function shotsOnTargetFormProvider(matches: Match[], window = XG_FORM_WINDOW): FormProvider {
  const byTeamSeason = new Map<string, { time: number; diff: number | null }[]>();
  const push = (key: string, entry: { time: number; diff: number | null }) => {
    const list = byTeamSeason.get(key);
    if (list) list.push(entry);
    else byTeamSeason.set(key, [entry]);
  };
  for (const m of matches) {
    const time = parseMatchDate(m.date).getTime();
    const has = m.shotsOnTargetHome !== undefined && m.shotsOnTargetAway !== undefined;
    const diff = has ? m.shotsOnTargetHome! - m.shotsOnTargetAway! : null;
    push(`${m.homeTeam}|${m.season}`, { time, diff });
    push(`${m.awayTeam}|${m.season}`, { time, diff: diff === null ? null : -diff });
  }
  for (const list of byTeamSeason.values()) list.sort((a, b) => a.time - b.time);

  const conversion = new Map<string, number | null>();
  const conversionFor = (season: string) => {
    if (!conversion.has(season)) conversion.set(season, goalsPerShotOnTarget(matches.filter((m) => m.season < season)));
    return conversion.get(season)!;
  };

  return (team, beforeDate, season) => {
    const factor = conversionFor(season);
    const list = byTeamSeason.get(`${team}|${season}`);
    if (factor === null || !list) return { form: 0, residual: 0 };
    const before = list.filter((e) => e.time < beforeDate.getTime());
    const recent = before.slice(-window).filter((e) => e.diff !== null);
    if (recent.length === 0) return { form: 0, residual: 0 };
    const mean = recent.reduce((s, e) => s + e.diff!, 0) / recent.length;
    return { form: mean * factor, residual: 0 };
  };
}

const formProviders = new Map<LeagueCode, FormProvider>();
export function leagueFormProvider(code: LeagueCode): FormProvider {
  if (code === "D1") return XG_FORM_PROVIDER;
  if (!formProviders.has(code)) formProviders.set(code, shotsOnTargetFormProvider(loadLeagueMatches(code)));
  return formProviders.get(code)!;
}

// Walk-forward fuer eine Liga, Saison fuer Saison (die Blockgroesse kann sich aendern).
export function leagueWalkForward(
  code: LeagueCode,
  seasons: string[],
  modelOptions: LeagueModelOptions,
  options: LeagueRunOptions = {}
): SeasonContexts[] {
  assertLeagueSeasons(code, seasons, options.holdoutPlan);
  if (options.holdoutPlan && seasons.some((s) => LEAGUE_HOLDOUT_SEASONS.includes(s))) {
    console.log(`  !! HOLDOUT ${code} ${seasons.filter((s) => LEAGUE_HOLDOUT_SEASONS.includes(s)).join(", ")} geoeffnet fuer: ${options.holdoutPlan}`);
  }
  const matches = loadLeagueMatches(code);
  const formOf = leagueFormProvider(code);
  return seasons.flatMap((season) =>
    buildWalkForwardContexts(
      [season],
      modelOptions,
      matches,
      options.buildModel ?? buildLeagueModel,
      options.benchmark ?? LEAGUE_BENCHMARK,
      matchesPerRound(matches, season),
      formOf
    )
  );
}

// Gepaarter Vergleich je Liga und gepoolt: a − b je Spiel (bei "kleiner ist besser" heisst
// positiv: b ist besser). Gepoolt wird ueber Spiele, jede Liga zaehlt also mit ihrer Fallzahl.
export function pairedByLeague(
  a: Map<LeagueCode, MatchEvaluation[]>,
  b: Map<LeagueCode, MatchEvaluation[]>,
  pick: (e: MatchEvaluation) => number | null
): { perLeague: Map<LeagueCode, BootstrapResult>; pooled: BootstrapResult } {
  const perLeague = new Map<LeagueCode, BootstrapResult>();
  const all: number[] = [];
  for (const [code, evA] of a) {
    const evB = b.get(code);
    if (!evB || evB.length !== evA.length) throw new Error(`ungepaart in ${code}`);
    const diffs: number[] = [];
    for (let i = 0; i < evA.length; i++) {
      if (evA[i].date !== evB[i].date || evA[i].homeTeam !== evB[i].homeTeam) throw new Error(`Reihenfolge in ${code}, Spiel ${i}`);
      const x = pick(evA[i]);
      const y = pick(evB[i]);
      if (x === null || y === null) continue;
      diffs.push(x - y);
    }
    perLeague.set(code, pairedBootstrap(diffs));
    all.push(...diffs);
  }
  return { perLeague, pooled: pairedBootstrap(all) };
}
