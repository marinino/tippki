// Konvergenz-Audit: war der alte Gradientenfit ueberhaupt auskonvergiert?
//
//   npm run convergence
//
// Der alte Fit lief mit fester Lernrate 0.0005 ueber genau 500 Vollgradientenschritte.
// Ob das reicht, wurde nie geprueft. Falls nicht, sind alle Teamstaerken Richtung
// Ligamitte gestaucht -- sichtbar an einer kleineren Streuung von attack - defense -- und
// jede Vorhersage faellt systematisch zu zaghaft aus.
//
// Verglichen werden drei Fits auf identischen Daten:
//   (a) Legacy: 500 Gradientenschritte, Lernrate 0.0005 (hier nachgebaut)
//   (b) Neu:    Block-Coordinate-Ascent in geschlossener Form
//   (c) Referenz: 200.000 Gradientenschritte -- praktisch das Optimum
//
// Danach der eigentliche Test: laufen beide Varianten durch die volle Pipeline, welche
// holt mehr Punkte? Gepaart, auf identischen Spielen.

import { loadAllMatches, type Match } from "../data/loadMatches";
import {
  buildLeagueModel,
  fitPoissonModel,
  poissonLogLikelihood,
  type LeagueModel,
  type LeagueModelOptions,
  type TeamStrength,
} from "../model/teamStrength";
import { formatSummary, summarize } from "../eval/metrics";
import { formatBootstrap, formatMcNemar, mcnemarExact, pairedBootstrap } from "../eval/significance";
import { resolveScheme } from "../eval/scoringScheme";
import { parseSplit, seasonsFor, type SplitName } from "../eval/splits";
import { buildContexts, evaluateRun, toPerMatchMetrics, type RunSpec } from "../eval/backtestCore";

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

// ---------------------------------------------------------------------------
// Nachbau des alten Fits, ausschliesslich fuer diesen Vergleich. Bewusst identisch zur
// entfernten Fassung, inklusive der asymmetrischen Eichung (nur attack wurde gepinnt).

function legacyGradientFit(
  matches: Match[],
  avgHomeGoals: number,
  avgAwayGoals: number,
  iterations: number,
  learningRate: number
): Map<string, TeamStrength> {
  const teamNames = [...new Set(matches.flatMap((m) => [m.homeTeam, m.awayTeam]))];
  const matchCounts = new Map<string, number>();
  for (const m of matches) {
    matchCounts.set(m.homeTeam, (matchCounts.get(m.homeTeam) ?? 0) + 1);
    matchCounts.set(m.awayTeam, (matchCounts.get(m.awayTeam) ?? 0) + 1);
  }
  const referenceTeam = [...matchCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];

  const attack = new Map(teamNames.map((t) => [t, 0]));
  const defense = new Map(teamNames.map((t) => [t, 0]));

  for (let iter = 0; iter < iterations; iter++) {
    const attackGrad = new Map(teamNames.map((t) => [t, 0]));
    const defenseGrad = new Map(teamNames.map((t) => [t, 0]));

    for (const m of matches) {
      const lambdaHome =
        avgHomeGoals * Math.exp(attack.get(m.homeTeam)!) * Math.exp(defense.get(m.awayTeam)!);
      const lambdaAway =
        avgAwayGoals * Math.exp(attack.get(m.awayTeam)!) * Math.exp(defense.get(m.homeTeam)!);

      const homeResidual = m.homeGoals - lambdaHome;
      const awayResidual = m.awayGoals - lambdaAway;

      attackGrad.set(m.homeTeam, attackGrad.get(m.homeTeam)! + homeResidual);
      defenseGrad.set(m.awayTeam, defenseGrad.get(m.awayTeam)! + homeResidual);
      attackGrad.set(m.awayTeam, attackGrad.get(m.awayTeam)! + awayResidual);
      defenseGrad.set(m.homeTeam, defenseGrad.get(m.homeTeam)! + awayResidual);
    }

    for (const team of teamNames) {
      if (team !== referenceTeam) {
        attack.set(team, attack.get(team)! + learningRate * attackGrad.get(team)!);
      }
      defense.set(team, defense.get(team)! + learningRate * defenseGrad.get(team)!);
    }
  }

  const result = new Map<string, TeamStrength>();
  for (const team of teamNames) {
    result.set(team, { attack: attack.get(team)!, defense: defense.get(team)! });
  }
  return result;
}

function leagueAverages(matches: Match[]) {
  return {
    avgHomeGoals: matches.reduce((s, m) => s + m.homeGoals, 0) / matches.length,
    avgAwayGoals: matches.reduce((s, m) => s + m.awayGoals, 0) / matches.length,
  };
}

function strengthSpread(teams: Map<string, TeamStrength>): number {
  const quality = [...teams.values()].map((t) => t.attack - t.defense);
  const mean = quality.reduce((s, q) => s + q, 0) / quality.length;
  return Math.sqrt(quality.reduce((s, q) => s + (q - mean) ** 2, 0) / quality.length);
}

// ---------------------------------------------------------------------------
// Teil 1: Konvergenz

const split: SplitName = flag("split") ? parseSplit(flag("split")) : "validation";
const seasons = seasonsFor(split);
const allMatches = loadAllMatches();

console.log("=== Konvergenz des alten Gradientenfits ===\n");
console.log(
  "Saison   LL(legacy)    LL(neu)       LL(referenz)  Luecke legacy  Streuung legacy/neu/ref"
);

for (const testSeason of seasons) {
  const train = allMatches.filter((m) => m.season < testSeason);
  const { avgHomeGoals, avgAwayGoals } = leagueAverages(train);

  const legacy = legacyGradientFit(train, avgHomeGoals, avgAwayGoals, 500, 0.0005);
  const modern = fitPoissonModel(train, avgHomeGoals, avgAwayGoals).teams;
  const reference = legacyGradientFit(train, avgHomeGoals, avgAwayGoals, 200000, 0.0005);

  const llLegacy = poissonLogLikelihood(train, legacy, avgHomeGoals, avgAwayGoals);
  const llModern = poissonLogLikelihood(train, modern, avgHomeGoals, avgAwayGoals);
  const llReference = poissonLogLikelihood(train, reference, avgHomeGoals, avgAwayGoals);

  console.log(
    `${testSeason}   ${llLegacy.toFixed(1).padStart(11)}  ${llModern.toFixed(1).padStart(11)}  ` +
      `${llReference.toFixed(1).padStart(11)}  ${(llReference - llLegacy).toFixed(1).padStart(12)}   ` +
      `${strengthSpread(legacy).toFixed(3)} / ${strengthSpread(modern).toFixed(3)} / ${strengthSpread(reference).toFixed(3)}`
  );
}

console.log(
  "\nEine positive Luecke heisst: der alte Fit hat das Optimum nicht erreicht.\n" +
    "Eine kleinere Streuung bedeutet zur Ligamitte gestauchte Teamstaerken -- das Modell\n" +
    "traut sich dann grundsaetzlich weniger zu, als die Daten hergeben."
);

// ---------------------------------------------------------------------------
// Teil 2: Wirkung auf die Zielgroesse

console.log("\n=== Wirkung in der vollen Pipeline (gepaart) ===\n");

const scheme = resolveScheme(flag("scheme"));
const RUN: RunSpec = { name: "voll", variant: "blended", tipMode: "ev", useTotals: true };

function buildLegacyModel(matches: Match[], _options: LeagueModelOptions): LeagueModel {
  const { avgHomeGoals, avgAwayGoals } = leagueAverages(matches);

  // Wie der alte buildLeagueModel: Vollfit fuer den Aufsteiger-Default, dann ein Fit pro
  // Saison, dann Recency-Gewichtung.
  const fullFit = legacyGradientFit(matches, avgHomeGoals, avgAwayGoals, 500, 0.0005);
  const weakest = [...fullFit.values()]
    .sort((a, b) => a.attack - a.defense - (b.attack - b.defense))
    .slice(0, 8);
  const promotedTeamDefault: TeamStrength = {
    attack: weakest.reduce((s, t) => s + t.attack, 0) / weakest.length,
    defense: weakest.reduce((s, t) => s + t.defense, 0) / weakest.length,
  };

  const seasonsNewestFirst = [...new Set(matches.map((m) => m.season))].sort().reverse();
  const weights = [0.6, 0.3, 0.05, 0.02, 0.02, 0.01];
  const perSeason = new Map<string, Map<string, TeamStrength>>();
  for (const season of seasonsNewestFirst) {
    const seasonMatches = matches.filter((m) => m.season === season);
    const avg = leagueAverages(seasonMatches);
    perSeason.set(
      season,
      legacyGradientFit(seasonMatches, avg.avgHomeGoals, avg.avgAwayGoals, 500, 0.0005)
    );
  }

  const teams = new Map<string, TeamStrength>();
  for (const team of fullFit.keys()) {
    let attack = 0;
    let defense = 0;
    let usedWeight = 0;
    seasonsNewestFirst.forEach((season, rank) => {
      const s = perSeason.get(season)!.get(team);
      const w = weights[rank] ?? 0;
      if (s) {
        attack += w * s.attack;
        defense += w * s.defense;
        usedWeight += w;
      }
    });
    const rest = 1 - usedWeight;
    teams.set(team, {
      attack: attack + rest * promotedTeamDefault.attack,
      defense: defense + rest * promotedTeamDefault.defense,
    });
  }

  return { avgHomeGoals, avgAwayGoals, teams, promotedTeamDefault };
}

const legacyContexts = buildContexts(seasons, {}, allMatches, buildLegacyModel);
const modernContexts = buildContexts(seasons, {}, allMatches);

const legacyEval = evaluateRun(legacyContexts, RUN, scheme);
const modernEval = evaluateRun(modernContexts, RUN, scheme);

console.log(formatSummary("alter Gradientenfit", summarize(legacyEval.map(toPerMatchMetrics))));
console.log(formatSummary("neuer Coordinate Fit", summarize(modernEval.map(toPerMatchMetrics))));

let onlyModern = 0;
let onlyLegacy = 0;
const rpsDiffs: number[] = [];
const pointsDiffs: number[] = [];

for (let i = 0; i < modernEval.length; i++) {
  const a = modernEval[i];
  const b = legacyEval[i];
  const aRight = a.predicted === a.actual;
  const bRight = b.predicted === b.actual;
  if (aRight && !bRight) onlyModern++;
  else if (!aRight && bRight) onlyLegacy++;
  rpsDiffs.push(b.rps - a.rps);
  pointsDiffs.push(a.points - b.points);
}

console.log("\nPositiv = neuer Fit besser:");
console.log(`  ${formatMcNemar("Tendenz (McNemar)", mcnemarExact(onlyModern, onlyLegacy))}`);
console.log(`  ${formatBootstrap("RPS (Bootstrap)", pairedBootstrap(rpsDiffs))}`);
console.log(`  ${formatBootstrap("Punkte/Spiel (Bootstrap)", pairedBootstrap(pointsDiffs))}`);
