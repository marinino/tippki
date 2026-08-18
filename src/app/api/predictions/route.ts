import { readFileSync } from "fs";
import { join } from "path";
import { loadAllMatches } from "../../../data/loadMatches";
import { buildLeagueModel } from "../../../model/teamStrength";
import { predictPipeline } from "../../../model/predictPipeline";
import { argmaxCell, toScoreGrid } from "../../../model/scoreMatrix";
import { computeXgForm } from "../../../model/xgForm";
import { cacheKey, readLlmCache } from "../../../llm/llmCache";
import { describeFactors } from "../../../llm/llmAdjustment";

// 0 bis 5 Tore je Seite. Darueber traegt die Matrix zusammen weit unter einem Prozent.
const DISPLAY_MAX_GOALS = 5;

interface Fixture {
  homeTeam: string;
  awayTeam: string;
  date: string;
  matchday: number;
}

export async function GET(request: Request) {
  const fixturesPath = join(process.cwd(), "data", "fixtures.json");
  const allFixtures: Fixture[] = JSON.parse(readFileSync(fixturesPath, "utf-8"));

  const logosPath = join(process.cwd(), "data", "teamLogos.json");
  const logosByTeam: Record<string, string> = JSON.parse(readFileSync(logosPath, "utf-8"));

  const availableMatchdays = [...new Set(allFixtures.map((f) => f.matchday))].sort((a, b) => a - b);

  const now = new Date();
  const upcoming = allFixtures.filter((f) => new Date(f.date) >= now);
  const nextMatchday = upcoming.length > 0 ? Math.min(...upcoming.map((f) => f.matchday)) : null;

  const params = new URL(request.url).searchParams;
  const requestedParam = params.get("matchday");
  const requestedMatchday = requestedParam ? Number(requestedParam) : null;
  const selectedMatchday =
    requestedMatchday && availableMatchdays.includes(requestedMatchday)
      ? requestedMatchday
      : nextMatchday;

  const fixtures = allFixtures.filter((f) => f.matchday === selectedMatchday);

  const matches = loadAllMatches();
  const model = buildLeagueModel(matches);

  // Kein Live-Abruf hier -- nur lesen, was zuletzt ueber den manuellen Knopf geholt wurde.
  // Ein Kontext aus einem anderen Spieltag waere schlimmer als keiner.
  const llmCache = readLlmCache();
  const llmByFixture =
    llmCache && llmCache.matchday === selectedMatchday ? llmCache.contexts : {};

  const predictions = fixtures.map(({ homeTeam, awayTeam, date }) => {
    const matchDate = new Date(date);
    const cachedLlm = llmByFixture[cacheKey(homeTeam, awayTeam)];

    const out = predictPipeline({
      model,
      homeTeam,
      awayTeam,
      homeForm: computeXgForm(homeTeam, matchDate),
      awayForm: computeXgForm(awayTeam, matchDate),
      llmContext: cachedLlm?.context ?? null,
    });

    return {
      homeTeam,
      awayTeam,
      homeLogo: logosByTeam[homeTeam] ?? null,
      awayLogo: logosByTeam[awayTeam] ?? null,
      date,
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
      llmApplied: out.llmAdjustment !== null && !out.llmAdjustment.blocked,
      llmBlocked: out.llmAdjustment?.blocked ?? false,
      llmShrinkFactor: out.llmAdjustment?.shrinkFactor ?? null,
      llmFactors: cachedLlm ? describeFactors(cachedLlm.context) : [],
      llmSummary: cachedLlm?.context.summary ?? null,
      llmSources: cachedLlm?.sources ?? [],
    };
  });

  return Response.json({
    predictions,
    matchday: selectedMatchday,
    nextMatchday,
    availableMatchdays,
    llmFetchedAt: llmCache && llmCache.matchday === selectedMatchday ? llmCache.fetchedAt : null,
    llmModel: llmCache && llmCache.matchday === selectedMatchday ? llmCache.model : null,
  });
}
