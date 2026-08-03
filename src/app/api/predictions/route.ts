import { readFileSync } from "fs";
import { join } from "path";
import { loadAllMatches } from "../../../data/loadMatches";
import { buildLeagueModel } from "../../../model/teamStrength";
import { predictMatch } from "../../../model/predictMatch";
import { computeXgForm } from "../../../model/xgForm";
import { readOddsCache } from "../../../data/oddsApi";
import { averageMarketProbabilities, blendWithMarket, ODDS_BLEND_ALPHA } from "../../../model/marketOdds";

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

  const requestedParam = new URL(request.url).searchParams.get("matchday");
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

  const predictions = fixtures.map(({ homeTeam, awayTeam, date }) => {
    const matchDate = new Date(date);
    const homeForm = computeXgForm(homeTeam, matchDate);
    const awayForm = computeXgForm(awayTeam, matchDate);
    const prediction = predictMatch(model, homeTeam, awayTeam, homeForm, awayForm);

    const fixtureOdds = oddsByFixture[`${homeTeam}|${awayTeam}`];
    const outcomeProbs = fixtureOdds
      ? blendWithMarket(prediction, averageMarketProbabilities(fixtureOdds.bookmakers), ODDS_BLEND_ALPHA)
      : prediction;

    return {
      homeTeam,
      awayTeam,
      homeLogo: logosByTeam[homeTeam] ?? null,
      awayLogo: logosByTeam[awayTeam] ?? null,
      date,
      expectedHomeGoals: prediction.expectedHomeGoals,
      expectedAwayGoals: prediction.expectedAwayGoals,
      homeWinProb: outcomeProbs.homeWinProb,
      drawProb: outcomeProbs.drawProb,
      awayWinProb: outcomeProbs.awayWinProb,
      mostLikelyScore: prediction.mostLikelyScore,
      homeIsEstimated: prediction.homeIsEstimated,
      awayIsEstimated: prediction.awayIsEstimated,
      oddsBlended: Boolean(fixtureOdds),
      bookmakerOdds: fixtureOdds?.bookmakers ?? null,
    };
  });

  return Response.json({
    predictions,
    matchday: selectedMatchday,
    nextMatchday,
    availableMatchdays,
    oddsFetchedAt: oddsCache && oddsCache.matchday === selectedMatchday ? oddsCache.fetchedAt : null,
  });
}
