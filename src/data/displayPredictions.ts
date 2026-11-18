// Die Zahlen, die die Seite je Partie zeigt -- an genau einer Stelle gerechnet.
//
// Route (/api/predictions) und Anpfiff-Schnappschuss (npm run kickoff-snapshot) rufen
// dieselbe Funktion. Das ist der ganze Punkt: der Schnappschuss soll exakt das festhalten,
// was in diesem Moment auf der Seite steht. Zwei Kopien derselben Rechnung waeren genau die
// Sorte Abweichung, die erst auffaellt, wenn eingefrorene und angezeigte Zahlen sich
// widersprechen (vgl. VERBESSERUNGEN.md, Punkt 16).

import { parseKickoff } from "./kickoff";
import type { LeagueModel } from "../model/teamStrength";
import { predictPipeline } from "../model/predictPipeline";
import { argmaxCell, toScoreGrid } from "../model/scoreMatrix";
import { computeXgForm } from "../model/xgForm";
import { priceOf, type PriceSheet } from "../model/priceSheet";
import { cacheKey, llmStatusOf, type LlmCacheFile, type LlmStatus } from "../llm/llmCache";
import { describeFactors } from "../llm/llmAdjustment";
import type { LlmKeyFactor } from "../llm/matchContext";

// 0 bis 5 Tore je Seite. Darueber traegt die Matrix zusammen weit unter einem Prozent.
export const DISPLAY_MAX_GOALS = 5;

export interface DisplayNumbers {
  expectedHomeGoals: number;
  expectedAwayGoals: number;
  // Wahrscheinlichkeit je Ergebnis, grid[Heimtore][Auswaertstore], 0..5 Tore je Seite.
  // Leer, wenn die Zahlen aus dem Vorwaerts-Log stammen -- das fuehrt keine Matrix.
  scoreGrid: number[][];
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  mostLikelyScore: string;
  prices: PriceSheet;
  homeIsEstimated: boolean;
  awayIsEstimated: boolean;
  llmApplied: boolean;
  llmStatus: LlmStatus;
  llmFailureReason: string | null;
  llmFetchedAt: string | null;
  llmHomeAdjustmentPct: number | null;
  llmAwayAdjustmentPct: number | null;
  llmFactors: string[];
  llmSummary: string | null;
  llmSources: string[];
}

export interface DisplayFixture {
  homeTeam: string;
  awayTeam: string;
  date: string;
}

// Live gerechnet: aktueller Fit, Form vor Anpfiff, Spielkontext aus dem Cache. Der Cache
// muss bereits auf den Spieltag der Partie geprueft sein (sonst null uebergeben).
export function liveDisplayNumbers(
  model: LeagueModel,
  fixture: DisplayFixture,
  cacheForMatchday: LlmCacheFile | null
): DisplayNumbers {
  const { homeTeam, awayTeam, date } = fixture;
  const matchDate = parseKickoff(date);
  const cachedLlm = cacheForMatchday?.contexts[cacheKey(homeTeam, awayTeam)];

  const out = predictPipeline({
    model,
    homeTeam,
    awayTeam,
    homeForm: computeXgForm(homeTeam, matchDate),
    awayForm: computeXgForm(awayTeam, matchDate),
    llmContext: cachedLlm?.context ?? null,
  });

  return {
    expectedHomeGoals: out.expectedHomeGoals,
    expectedAwayGoals: out.expectedAwayGoals,
    scoreGrid: toScoreGrid(out.matrix, DISPLAY_MAX_GOALS),
    homeWinProb: out.probs.homeWinProb,
    drawProb: out.probs.drawProb,
    awayWinProb: out.probs.awayWinProb,
    mostLikelyScore: argmaxCell(out.matrix),
    prices: out.prices,
    homeIsEstimated: out.homeIsEstimated,
    awayIsEstimated: out.awayIsEstimated,
    llmApplied: out.llmAdjustment !== null,
    // Vier Zustaende statt eines Ja/Nein -- siehe llmStatusOf.
    llmStatus: llmStatusOf(cacheForMatchday, homeTeam, awayTeam, out.llmAdjustment !== null),
    llmFailureReason: cacheForMatchday?.failures?.[cacheKey(homeTeam, awayTeam)] ?? null,
    llmFetchedAt: cachedLlm?.fetchedAt ?? null,
    // Relative Aenderung der Torerwartung je Seite, in Prozent -- die Groesse, an der sich
    // beobachten laesst, ob der Layer ueberhaupt etwas tut.
    llmHomeAdjustmentPct: out.llmAdjustment ? (Math.exp(out.llmAdjustment.homeLogAdj) - 1) * 100 : null,
    llmAwayAdjustmentPct: out.llmAdjustment ? (Math.exp(out.llmAdjustment.awayLogAdj) - 1) * 100 : null,
    llmFactors: cachedLlm ? describeFactors(cachedLlm.context) : [],
    llmSummary: cachedLlm?.context.summary ?? null,
    llmSources: cachedLlm?.sources ?? [],
  };
}

// Die Teile einer Zeile aus data/forward_log.jsonl, die die Anzeige braucht.
export interface LoggedVariant {
  probs: { homeWinProb: number; drawProb: number; awayWinProb: number };
  expectedGoals: [number, number];
  over25: number;
  bttsYes: number;
  handicaps: { line: number; homeProb: number }[];
  topScores: { score: string; prob: number }[];
  mostLikelyScore: string;
}

export interface LoggedRow {
  loggedAt: string;
  season: string;
  matchday: number;
  homeTeam: string;
  awayTeam: string;
  kickoff: string;
  llm: {
    fetchedAt?: string;
    foundAnything: boolean;
    keyFactors: LlmKeyFactor[];
    summary: string;
    sources: string[];
    homeLogAdj: number;
    awayLogAdj: number;
  } | null;
  variants: { model: LoggedVariant; withLlm: LoggedVariant };
}

// Fuer eine angepfiffene Partie ohne Anpfiff-Schnappschuss: die protokollierte Vorhersage.
//
// Nichts wird neu gerechnet. Jede Zahl ist entweder ein geloggter Wert oder eine exakte
// Umformung davon (Quote = 1/Wahrscheinlichkeit, Doppelte Chance = Summe zweier Ausgaenge,
// Gegenwette = 1 - Wette). Damit ist sie genauso unveraenderlich wie die Logzeile selbst.
// Was das Log nicht fuehrt, fehlt: Matrix, Torsummen ausser 2,5, Ergebnisse ab Rang 11.
export function displayNumbersFromLog(row: LoggedRow): DisplayNumbers {
  const v = row.llm ? row.variants.withLlm : row.variants.model;
  const { homeWinProb, drawProb, awayWinProb } = v.probs;
  const [home, away] = v.expectedGoals;
  const topSum = v.topScores.reduce((s, c) => s + c.prob, 0);

  const prices: PriceSheet = {
    outcome: { home: priceOf(homeWinProb), draw: priceOf(drawProb), away: priceOf(awayWinProb) },
    doubleChance: {
      homeOrDraw: priceOf(homeWinProb + drawProb),
      homeOrAway: priceOf(homeWinProb + awayWinProb),
      drawOrAway: priceOf(drawProb + awayWinProb),
    },
    bothTeamsToScore: { yes: priceOf(v.bttsYes), no: priceOf(1 - v.bttsYes) },
    totals: [{ line: 2.5, over: priceOf(v.over25), under: priceOf(1 - v.over25) }],
    handicaps: v.handicaps.map((h) => ({ line: h.line, home: priceOf(h.homeProb), away: priceOf(1 - h.homeProb) })),
    correctScore: v.topScores.map((c) => {
      const [hg, ag] = c.score.split(":").map(Number);
      return { score: c.score, homeGoals: hg, awayGoals: ag, price: priceOf(c.prob) };
    }),
    correctScoreOther: priceOf(1 - topSum),
    expectedGoals: { home, away, total: home + away },
  };

  const applied = row.llm != null && (row.llm.homeLogAdj !== 0 || row.llm.awayLogAdj !== 0);
  return {
    expectedHomeGoals: home,
    expectedAwayGoals: away,
    scoreGrid: [],
    homeWinProb,
    drawProb,
    awayWinProb,
    mostLikelyScore: v.mostLikelyScore,
    prices,
    // Steht nicht im Log. Nur ein Anzeigehinweis (Sternchen am Namen), keine Zahl.
    homeIsEstimated: false,
    awayIsEstimated: false,
    llmApplied: applied,
    llmStatus: row.llm == null ? "nicht_recherchiert" : applied ? "korrigiert" : "ohne_befund",
    llmFailureReason: null,
    llmFetchedAt: row.llm?.fetchedAt ?? null,
    llmHomeAdjustmentPct: applied ? (Math.exp(row.llm!.homeLogAdj) - 1) * 100 : null,
    llmAwayAdjustmentPct: applied ? (Math.exp(row.llm!.awayLogAdj) - 1) * 100 : null,
    llmFactors: row.llm
      ? describeFactors({
          homeTeam: row.homeTeam,
          awayTeam: row.awayTeam,
          foundAnything: row.llm.foundAnything,
          summary: row.llm.summary,
          keyFactors: row.llm.keyFactors,
        })
      : [],
    llmSummary: row.llm?.summary ?? null,
    llmSources: row.llm?.sources ?? [],
  };
}
