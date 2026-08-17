import { readFileSync } from "fs";
import { join } from "path";
import { loadAllMatches } from "../../../data/loadMatches";
import { buildLeagueModel } from "../../../model/teamStrength";
import { predictPipeline } from "../../../model/predictPipeline";
import { computeXgForm } from "../../../model/xgForm";
import { readOddsCache } from "../../../data/oddsApi";
import { averageMarketProbabilities } from "../../../model/marketOdds";
import { resolveScheme } from "../../../eval/scoringScheme";
import { cacheKey, readLlmCache } from "../../../llm/llmCache";
import { describeFactors } from "../../../llm/llmAdjustment";

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
  const scheme = resolveScheme(params.get("scheme"));

  const requestedParam = params.get("matchday");
  const requestedMatchday = requestedParam ? Number(requestedParam) : null;
  const selectedMatchday =
    requestedMatchday && availableMatchdays.includes(requestedMatchday) ? requestedMatchday : nextMatchday;

  const fixtures = allFixtures.filter((f) => f.matchday === selectedMatchday);

  const matches = loadAllMatches();
  const model = buildLeagueModel(matches);

  // Kein Live-Abruf hier -- nur lesen, was zuletzt ueber den manuellen "Quoten aktualisieren"-
  // Knopf (POST /api/refresh-odds) geholt wurde. Nur verwenden, wenn der Cache zum angezeigten
  // Spieltag passt (sonst wuerden veraltete Quoten eines anderen Spieltags einfliessen).
  const oddsCache = readOddsCache();
  const oddsByFixture = oddsCache && oddsCache.matchday === selectedMatchday ? oddsCache.odds : {};

  // Gleiche Staleness-Pruefung wie bei den Quoten: ein Kontext aus einem anderen Spieltag
  // waere schlimmer als keiner.
  const llmCache = readLlmCache();
  const llmByFixture =
    llmCache && llmCache.matchday === selectedMatchday ? llmCache.contexts : {};

  const predictions = fixtures.map(({ homeTeam, awayTeam, date }) => {
    const matchDate = new Date(date);
    const fixtureOdds = oddsByFixture[`${homeTeam}|${awayTeam}`];
    const cachedLlm = llmByFixture[cacheKey(homeTeam, awayTeam)];

    // Die Marktquoten gehen jetzt in die Score-Matrix ein, nicht nur in die 1X2-Balken --
    // vorher kam der angezeigte Tipp aus der ungeblendeten Modellmatrix und ignorierte
    // die beste verfuegbare Information vollstaendig.
    const out = predictPipeline({
      model,
      homeTeam,
      awayTeam,
      homeForm: computeXgForm(homeTeam, matchDate),
      awayForm: computeXgForm(awayTeam, matchDate),
      market1x2: fixtureOdds ? averageMarketProbabilities(fixtureOdds.bookmakers) : null,
      marketTotals: fixtureOdds?.totals ?? null,
      marketSpread: fixtureOdds?.spread ?? null,
      llmContext: cachedLlm?.context ?? null,
      scheme,
    });

    return {
      homeTeam,
      awayTeam,
      homeLogo: logosByTeam[homeTeam] ?? null,
      awayLogo: logosByTeam[awayTeam] ?? null,
      date,
      expectedHomeGoals: out.expectedHomeGoals,
      expectedAwayGoals: out.expectedAwayGoals,
      homeWinProb: out.finalProbs.homeWinProb,
      drawProb: out.finalProbs.drawProb,
      awayWinProb: out.finalProbs.awayWinProb,
      tip: out.tip.tip,
      expectedPoints: out.tip.expectedPoints,
      runnerUpTip: out.tip.runnerUpTip,
      runnerUpExpectedPoints: out.tip.runnerUpExpectedPoints,
      argmaxTip: out.tip.argmaxCellTip,
      // Altes Feld bleibt befuellt, damit aeltere Clients nicht brechen.
      mostLikelyScore: out.tip.tip,
      homeIsEstimated: out.homeIsEstimated,
      awayIsEstimated: out.awayIsEstimated,
      oddsBlended: out.marketApplied,
      marketConstraints: out.marketConstraints,
      bookmakerOdds: fixtureOdds?.bookmakers ?? null,
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
    scheme: scheme.key,
    schemeLabel: scheme.label,
    oddsFetchedAt: oddsCache && oddsCache.matchday === selectedMatchday ? oddsCache.fetchedAt : null,
    llmFetchedAt: llmCache && llmCache.matchday === selectedMatchday ? llmCache.fetchedAt : null,
    llmModel: llmCache && llmCache.matchday === selectedMatchday ? llmCache.model : null,
  });
}
