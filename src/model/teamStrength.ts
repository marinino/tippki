import { Match, parseMatchDate } from "../data/loadMatches";
import { lookupMatchXg } from "./xgLookup";

export type FitTarget = "goals" | "xg" | "blend";

export interface TeamStrength {
  attack: number;
  defense: number;
}

export interface LeagueModel {
  avgHomeGoals: number;
  avgAwayGoals: number;
  teams: Map<string, TeamStrength>;
  promotedTeamDefault: TeamStrength;
  diagnostics?: FitDiagnostics;
}

function leagueAverages(matches: Match[]): { avgHomeGoals: number; avgAwayGoals: number } {
  const numMatches = matches.length;
  const totalHomeGoals = matches.reduce((sum, m) => sum + m.homeGoals, 0);
  const totalAwayGoals = matches.reduce((sum, m) => sum + m.awayGoals, 0);
  return {
    avgHomeGoals: totalHomeGoals / numMatches,
    avgAwayGoals: totalAwayGoals / numMatches,
  };
}

export interface FitOptions {
  maxSweeps?: number;
  tolerance?: number;
  // Gewicht je Spiel, gleiche Reihenfolge wie `matches`. Ohne Angabe zaehlt jedes Spiel 1.
  // Damit laesst sich Aktualitaet stufenlos ausdruecken, statt sie ueber Saisonbloecke
  // zu treppen.
  weights?: Float64Array;
  // Woraus die Staerken geschaetzt werden. "xg" ist dasselbe Mass mit weniger Rauschen,
  // "blend" mischt beides mit xgBlendWeight als Anteil der ECHTEN Tore.
  target?: FitTarget;
  xgBlendWeight?: number;
  // Ridge/Shrinkage in "Pseudo-Spielen": das Team hat zusaetzlich k Spiele bestritten, in
  // denen es exakt im Ligadurchschnitt getroffen und kassiert hat. Formal ein
  // Gamma-Prior auf exp(attack). Wirkt vor allem bei den Ein-Saison-Fits (34 Spiele je
  // Team) und bei Aufsteigern mit duenner Historie. k = 0 ist die reine ML-Schaetzung.
  ridgePseudoMatches?: number;
  trace?: boolean;
}

export interface FitDiagnostics {
  sweeps: number;
  converged: boolean;
  finalLogLikelihood: number;
  maxParameterDelta: number;
  logLikelihoodTrace: number[];
}

export interface FitResult {
  teams: Map<string, TeamStrength>;
  diagnostics: FitDiagnostics;
}

const DEFAULT_MAX_SWEEPS = 200;
const DEFAULT_TOLERANCE = 1e-12;

// Block-Coordinate-Ascent mit geschlossener Loesung statt Gradientenaufstieg.
//
// Vorher: 500 Vollgradientenschritte mit fester Lernrate 0.0005. Ob das konvergiert, war
// nie geprueft -- und ein unterkonvergierter Fit staucht alle Teamstaerken Richtung
// Ligamitte, wodurch jede Vorhersage systematisch zu zaghaft wird.
//
// Die Log-Likelihood ist in diesen Parametern konkav, und die Nullstelle der Ableitung
// hat eine geschlossene Form. Aus dLL/dattack_i = 0 folgt "Summe der erwarteten Tore von
// Team i" = "Summe der tatsaechlichen Tore von Team i", also
//
//   exp(attack_i)  = G_i / S_i   mit S_i = Σ_{i heim} A·exp(def_gegner) + Σ_{i ausw} B·exp(def_gegner)
//   exp(defense_i) = C_i / T_i   mit T_i = Σ_{i heim} B·exp(att_gegner) + Σ_{i ausw} A·exp(att_gegner)
//
// Alle attack_i sind bei festen defense_j voneinander unabhaengig, der Block laesst sich
// also in einem Schritt exakt maximieren. Kein Lernratenparameter, keine Divergenz,
// Konvergenz in wenigen Dutzend Sweeps.
export function fitPoissonModel(
  matches: Match[],
  avgHomeGoals: number,
  avgAwayGoals: number,
  options: FitOptions = {}
): FitResult {
  const maxSweeps = options.maxSweeps ?? DEFAULT_MAX_SWEEPS;
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const ridge = options.ridgePseudoMatches ?? 0;

  const teamNames = [...new Set(matches.flatMap((m) => [m.homeTeam, m.awayTeam]))];
  const indexOf = new Map(teamNames.map((t, i) => [t, i]));
  const n = teamNames.length;

  // Flache Arrays statt Map-Zugriffe: der Fit laeuft in der Hyperparametersuche sehr oft.
  const homeIdx = new Int32Array(matches.length);
  const awayIdx = new Int32Array(matches.length);
  const goalsFor = new Float64Array(n);
  const goalsAgainst = new Float64Array(n);
  // Gewichtete Spielzahl je Team -- der Ridge muss zu den gewichteten Toren passen,
  // sonst wuerde er bei starker Zeitgewichtung viel zu stark ziehen.
  const weightSum = new Float64Array(n);

  const targets = resolveTargets(matches, options);

  for (let m = 0; m < matches.length; m++) {
    const match = matches[m];
    const h = indexOf.get(match.homeTeam)!;
    const a = indexOf.get(match.awayTeam)!;
    const w = options.weights ? options.weights[m] : 1;
    homeIdx[m] = h;
    awayIdx[m] = a;
    goalsFor[h] += w * targets.home[m];
    goalsAgainst[h] += w * targets.away[m];
    goalsFor[a] += w * targets.away[m];
    goalsAgainst[a] += w * targets.home[m];
    weightSum[h] += w;
    weightSum[a] += w;
  }

  const meanWeight =
    matches.length > 0
      ? [...weightSum].reduce((s, v) => s + v, 0) / (2 * matches.length)
      : 1;

  const expAttack = new Float64Array(n).fill(1);
  const expDefense = new Float64Array(n).fill(1);
  const scale = new Float64Array(n);

  const trace: number[] = [];
  let sweeps = 0;
  let maxParameterDelta = Infinity;
  let converged = false;

  for (; sweeps < maxSweeps; sweeps++) {
    maxParameterDelta = 0;

    // Angriffsblock: S_i aufsummieren, dann geschlossen setzen.
    scale.fill(0);
    for (let m = 0; m < matches.length; m++) {
      const w = options.weights ? options.weights[m] : 1;
      scale[homeIdx[m]] += w * avgHomeGoals * expDefense[awayIdx[m]];
      scale[awayIdx[m]] += w * avgAwayGoals * expDefense[homeIdx[m]];
    }
    for (let i = 0; i < n; i++) {
      const prior = ridge * meanWeight;
      const denominator = scale[i] + prior;
      if (denominator <= 0) continue;
      const next = (goalsFor[i] + prior) / denominator;
      if (next <= 0) continue;
      maxParameterDelta = Math.max(maxParameterDelta, Math.abs(Math.log(next / expAttack[i])));
      expAttack[i] = next;
    }

    // Abwehrblock, mit den gerade aktualisierten Angriffswerten.
    scale.fill(0);
    for (let m = 0; m < matches.length; m++) {
      const w = options.weights ? options.weights[m] : 1;
      scale[homeIdx[m]] += w * avgAwayGoals * expAttack[awayIdx[m]];
      scale[awayIdx[m]] += w * avgHomeGoals * expAttack[homeIdx[m]];
    }
    for (let i = 0; i < n; i++) {
      const prior = ridge * meanWeight;
      const denominator = scale[i] + prior;
      if (denominator <= 0) continue;
      const next = (goalsAgainst[i] + prior) / denominator;
      if (next <= 0) continue;
      maxParameterDelta = Math.max(maxParameterDelta, Math.abs(Math.log(next / expDefense[i])));
      expDefense[i] = next;
    }

    if (options.trace) {
      trace.push(logLikelihoodFromExp(matches, homeIdx, awayIdx, expAttack, expDefense, avgHomeGoals, avgAwayGoals));
    }

    if (maxParameterDelta < tolerance) {
      sweeps++;
      converged = true;
      break;
    }
  }

  // Eichung. Die Likelihood haengt nur von attack_i + defense_j ab, es gibt also eine
  // exakt flache Richtung: c auf alle Angriffe, -c auf alle Abwehrwerte, lambda bleibt
  // gleich. Fixiert wird sie durch Zentrieren auf Mittelwert 0.
  //
  // Vorher wurde stattdessen der Angriffswert EINES Teams auf 0 gepinnt (und die Abwehr
  // gar nicht) -- eine asymmetrische Eichung, die an einem willkuerlich gewaehlten Team
  // haengt. Schlimmer noch: buildLeagueModel fittet jede Saison einzeln und mittelt die
  // Ergebnisse. Wenn das Ankerteam von Saison zu Saison staerker oder schwaecher wird,
  // verschiebt sich die gesamte Skala mit -- und dann werden Groessen gemittelt, die gar
  // nicht auf derselben Skala liegen. Das Zentrieren behebt auch das.
  let meanLogAttack = 0;
  for (let i = 0; i < n; i++) meanLogAttack += Math.log(expAttack[i]);
  meanLogAttack /= n;

  const teams = new Map<string, TeamStrength>();
  for (let i = 0; i < n; i++) {
    teams.set(teamNames[i], {
      attack: Math.log(expAttack[i]) - meanLogAttack,
      defense: Math.log(expDefense[i]) + meanLogAttack,
    });
  }

  return {
    teams,
    diagnostics: {
      sweeps,
      converged,
      finalLogLikelihood: logLikelihoodFromExp(
        matches,
        homeIdx,
        awayIdx,
        expAttack,
        expDefense,
        avgHomeGoals,
        avgAwayGoals
      ),
      maxParameterDelta,
      logLikelihoodTrace: trace,
    },
  };
}

// Woraus die Staerken geschaetzt werden. Fuer "goals" sind das die echten Tore, fuer
// "xg" die Expected Goals desselben Spiels, fuer "blend" eine Mischung.
//
// Wichtig: fehlt fuer ein Spiel der xG-Wert (kein Namensmapping, Luecke in den Daten),
// wird auf die echten Tore zurueckgefallen statt das Spiel zu verwerfen. Ein Spiel
// stillschweigend auszulassen wuerde die betroffenen Teams systematisch benachteiligen.
function resolveTargets(
  matches: Match[],
  options: FitOptions
): { home: Float64Array; away: Float64Array; xgCoverage: number } {
  const home = new Float64Array(matches.length);
  const away = new Float64Array(matches.length);
  const target = options.target ?? "goals";

  if (target === "goals") {
    for (let m = 0; m < matches.length; m++) {
      home[m] = matches[m].homeGoals;
      away[m] = matches[m].awayGoals;
    }
    return { home, away, xgCoverage: 0 };
  }

  // Bei "blend" ist xgBlendWeight der Anteil der ECHTEN Tore.
  const goalShare = target === "xg" ? 0 : (options.xgBlendWeight ?? 0.5);
  let covered = 0;

  for (let m = 0; m < matches.length; m++) {
    const match = matches[m];
    const xg = lookupMatchXg(match.homeTeam, match.awayTeam, parseMatchDate(match.date));
    if (!xg) {
      home[m] = match.homeGoals;
      away[m] = match.awayGoals;
      continue;
    }
    covered++;
    home[m] = goalShare * match.homeGoals + (1 - goalShare) * xg.homeXG;
    away[m] = goalShare * match.awayGoals + (1 - goalShare) * xg.awayXG;
  }

  return { home, away, xgCoverage: matches.length > 0 ? covered / matches.length : 0 };
}

// Exponentielle Zeitgewichtung: exp(-ln(2) * Alter / Halbwertszeit).
//
// Ersetzt die bisherige Stufenfunktion SEASON_RECENCY_WEIGHTS, bei der ein Spiel vom
// ersten Tag der Vorsaison exakt so viel zaehlte wie eines vom letzten -- und beim
// Saisonwechsel sprang das Gewicht von 0.6 auf 0.3. Dixon-Coles machen das im Original
// stufenlos in Tagen, und genau das passiert hier.
export function exponentialTimeWeights(
  matches: Match[],
  halfLifeDays: number,
  referenceDate?: Date
): Float64Array {
  const weights = new Float64Array(matches.length);
  if (matches.length === 0) return weights;

  const times = matches.map((m) => parseMatchDate(m.date).getTime());
  const reference = referenceDate ? referenceDate.getTime() : Math.max(...times);
  const decay = Math.LN2 / halfLifeDays;
  const dayMs = 24 * 60 * 60 * 1000;

  for (let m = 0; m < matches.length; m++) {
    const ageDays = Math.max(0, (reference - times[m]) / dayMs);
    weights[m] = Math.exp(-decay * ageDays);
  }

  return weights;
}

function logLikelihoodFromExp(
  matches: Match[],
  homeIdx: Int32Array,
  awayIdx: Int32Array,
  expAttack: Float64Array,
  expDefense: Float64Array,
  avgHomeGoals: number,
  avgAwayGoals: number
): number {
  let logLikelihood = 0;
  for (let m = 0; m < matches.length; m++) {
    const h = homeIdx[m];
    const a = awayIdx[m];
    const lambdaHome = avgHomeGoals * expAttack[h] * expDefense[a];
    const lambdaAway = avgAwayGoals * expAttack[a] * expDefense[h];
    logLikelihood += -lambdaHome + matches[m].homeGoals * Math.log(lambdaHome);
    logLikelihood += -lambdaAway + matches[m].awayGoals * Math.log(lambdaAway);
  }
  return logLikelihood;
}

export function poissonLogLikelihood(
  matches: Match[],
  teams: Map<string, TeamStrength>,
  avgHomeGoals: number,
  avgAwayGoals: number
): number {
  let logLikelihood = 0;
  for (const m of matches) {
    const home = teams.get(m.homeTeam);
    const away = teams.get(m.awayTeam);
    if (!home || !away) continue;
    const lambdaHome = avgHomeGoals * Math.exp(home.attack) * Math.exp(away.defense);
    const lambdaAway = avgAwayGoals * Math.exp(away.attack) * Math.exp(home.defense);
    logLikelihood += -lambdaHome + m.homeGoals * Math.log(lambdaHome);
    logLikelihood += -lambdaAway + m.awayGoals * Math.log(lambdaAway);
  }
  return logLikelihood;
}

const WEAKEST_TEAM_COUNT = 8;

function computePromotedTeamDefault(teams: Map<string, TeamStrength>): TeamStrength {
  // Qualitaet = attack - defense: hoher Angriffswert und niedriger (guter) Abwehrwert sind gut.
  const weakest = [...teams.values()]
    .sort((a, b) => a.attack - a.defense - (b.attack - b.defense))
    .slice(0, WEAKEST_TEAM_COUNT);

  return {
    attack: weakest.reduce((sum, t) => sum + t.attack, 0) / weakest.length,
    defense: weakest.reduce((sum, t) => sum + t.defense, 0) / weakest.length,
  };
}

// Gewicht der letzten, vorletzten, ... Saison. Was fuer ein Team unbelegt bleibt
// (fehlende Saison oder das Reststueck bis 100%) faellt an promotedTeamDefault.
export const SEASON_RECENCY_WEIGHTS = [0.6, 0.3, 0.05, 0.02, 0.02, 0.01];

function applyRecencyWeighting(
  allTeamNames: string[],
  seasonsNewestFirst: string[],
  perSeasonTeams: Map<string, Map<string, TeamStrength>>,
  promotedTeamDefault: TeamStrength,
  weights: number[]
): Map<string, TeamStrength> {
  const weighted = new Map<string, TeamStrength>();

  for (const team of allTeamNames) {
    let attack = 0;
    let defense = 0;
    let usedWeight = 0;

    seasonsNewestFirst.forEach((season, rank) => {
      const seasonStrength = perSeasonTeams.get(season)!.get(team);
      const weight = weights[rank] ?? 0;
      if (seasonStrength) {
        attack += weight * seasonStrength.attack;
        defense += weight * seasonStrength.defense;
        usedWeight += weight;
      }
    });

    const defaultWeight = 1 - usedWeight;
    attack += defaultWeight * promotedTeamDefault.attack;
    defense += defaultWeight * promotedTeamDefault.defense;

    weighted.set(team, { attack, defense });
  }

  return weighted;
}

export interface LeagueModelOptions extends FitOptions {
  seasonRecencyWeights?: number[];
  // Ist das gesetzt, ersetzt EIN gewichteter Fit ueber alle Spiele die bisherigen
  // Per-Saison-Fits samt Nachgewichtung. Das ist nicht nur feiner aufgeloest, es raeumt
  // auch eine strukturelle Schwaeche aus: bei getrennten Saisonfits wird jede Saison
  // separat geeicht, und anschliessend werden Groessen gemittelt, die gar nicht
  // zwingend auf derselben Skala liegen.
  halfLifeDays?: number;
}

// Ein Fit kostet mehrere Durchlaeufe ueber alle Spiele, plus einen eigenen Fit pro
// Saison -- bei jedem Seitenaufruf erneut. Der Cache haengt an der Identitaet des
// uebergebenen Arrays: loadAllMatches() liefert dank eigenem Memo immer dieselbe Instanz,
// waehrend der Backtest pro Saison ein frisch gefiltertes Array uebergibt und dadurch
// korrekterweise neu fittet. Nach clearMatchCache() ist die alte Instanz unerreichbar und
// der Eintrag verschwindet von selbst.
const modelCache = new WeakMap<Match[], Map<string, LeagueModel>>();

function optionsKey(options: LeagueModelOptions): string {
  return JSON.stringify([
    options.ridgePseudoMatches ?? 0,
    options.seasonRecencyWeights ?? SEASON_RECENCY_WEIGHTS,
    options.maxSweeps ?? DEFAULT_MAX_SWEEPS,
    options.tolerance ?? DEFAULT_TOLERANCE,
    options.halfLifeDays ?? null,
    options.target ?? "goals",
    options.xgBlendWeight ?? null,
  ]);
}

export function buildLeagueModel(matches: Match[], options: LeagueModelOptions = {}): LeagueModel {
  const key = optionsKey(options);
  let byOptions = modelCache.get(matches);
  if (byOptions) {
    const cached = byOptions.get(key);
    if (cached) return cached;
  } else {
    byOptions = new Map();
    modelCache.set(matches, byOptions);
  }

  const model = fitLeagueModel(matches, options);
  byOptions.set(key, model);
  return model;
}

function fitLeagueModel(matches: Match[], options: LeagueModelOptions): LeagueModel {
  const { avgHomeGoals, avgAwayGoals } = leagueAverages(matches);

  // Weg A: ein gewichteter Fit ueber alles. Aktualitaet steckt in den Gewichten, es gibt
  // keine Saisonbloecke und nichts nachzugewichten.
  if (options.halfLifeDays !== undefined) {
    const timeWeights = exponentialTimeWeights(matches, options.halfLifeDays);
    const fit = fitPoissonModel(matches, avgHomeGoals, avgAwayGoals, {
      ...options,
      weights: timeWeights,
    });

    return {
      avgHomeGoals,
      avgAwayGoals,
      teams: fit.teams,
      promotedTeamDefault: computePromotedTeamDefault(fit.teams),
      diagnostics: fit.diagnostics,
    };
  }

  // Weg B: das bisherige Verfahren -- ein Fit je Saison, anschliessend nach Aktualitaet
  // gemittelt. Bleibt als Vergleichsbasis erhalten.
  const weights = options.seasonRecencyWeights ?? SEASON_RECENCY_WEIGHTS;

  const fullFit = fitPoissonModel(matches, avgHomeGoals, avgAwayGoals, options);
  const promotedTeamDefault = computePromotedTeamDefault(fullFit.teams);

  const seasonsNewestFirst = [...new Set(matches.map((m) => m.season))].sort().reverse();
  const perSeasonTeams = new Map<string, Map<string, TeamStrength>>();
  for (const season of seasonsNewestFirst) {
    const seasonMatches = matches.filter((m) => m.season === season);
    const seasonAverages = leagueAverages(seasonMatches);
    perSeasonTeams.set(
      season,
      fitPoissonModel(seasonMatches, seasonAverages.avgHomeGoals, seasonAverages.avgAwayGoals, options)
        .teams
    );
  }

  const teams = applyRecencyWeighting(
    [...fullFit.teams.keys()],
    seasonsNewestFirst,
    perSeasonTeams,
    promotedTeamDefault,
    weights
  );

  return {
    avgHomeGoals,
    avgAwayGoals,
    teams,
    promotedTeamDefault,
    diagnostics: fullFit.diagnostics,
  };
}
