import { readFileSync } from "fs";
import { join } from "path";
import { isAdminRequest } from "../../../data/adminAuth";
import { isReadOnlyDeployment } from "../../../data/deployment";
import { nextMatchdayOf, parseKickoff } from "../../../data/kickoff";
import { loadAllMatches } from "../../../data/loadMatches";
import { buildLeagueModel } from "../../../model/teamStrength";
import { predictPipeline } from "../../../model/predictPipeline";
import { argmaxCell, toScoreGrid } from "../../../model/scoreMatrix";
import { computeXgForm } from "../../../model/xgForm";
import { cacheKey, llmStatusOf, readLlmCache } from "../../../llm/llmCache";
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

  // parseKickoff, nicht new Date: diese Route laeuft in der Cloud unter UTC, und ein
  // zonenloser Zeitstempel wuerde dort jeden Anpfiff zwei Stunden spaeter verorten -- der
  // Spieltag bliebe nach dem letzten Anpfiff noch zwei Stunden lang der "naechste".
  const nextMatchday = nextMatchdayOf(allFixtures);

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
  const cacheForMatchday =
    llmCache && llmCache.matchday === selectedMatchday ? llmCache : null;
  const llmByFixture = cacheForMatchday ? cacheForMatchday.contexts : {};

  const predictions = fixtures.map(({ homeTeam, awayTeam, date }) => {
    const matchDate = parseKickoff(date);
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
      llmApplied: out.llmAdjustment !== null,
      // Vier Zustaende statt eines Ja/Nein -- siehe llmStatusOf. "reines Modell" hiess
      // bisher sowohl "nie gefragt" als auch "gefragt, nichts gefunden".
      llmStatus: llmStatusOf(cacheForMatchday, homeTeam, awayTeam, out.llmAdjustment !== null),
      llmFailureReason: cacheForMatchday?.failures?.[cacheKey(homeTeam, awayTeam)] ?? null,
      llmFetchedAt: cachedLlm?.fetchedAt ?? null,
      // Relative Aenderung der Torerwartung je Seite, in Prozent. Seit dem Ausbau der
      // Favoritensicherung ist das die einzige Groesse, die zwischen zwei Korrekturen noch
      // variiert -- und damit die, an der sich beobachten laesst, ob der Layer ueberhaupt
      // etwas tut.
      llmHomeAdjustmentPct: out.llmAdjustment
        ? (Math.exp(out.llmAdjustment.homeLogAdj) - 1) * 100
        : null,
      llmAwayAdjustmentPct: out.llmAdjustment
        ? (Math.exp(out.llmAdjustment.awayLogAdj) - 1) * 100
        : null,
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
    llmFetchedAt: cacheForMatchday ? cacheForMatchday.fetchedAt : null,
    llmModel: cacheForMatchday ? cacheForMatchday.model : null,
    // Ohne diese Zahlen ist "ohne Befund" nicht von "hat nie gesucht" zu unterscheiden --
    // genau der blinde Fleck, der Spieltag 1 gekostet hat. undefined bei Staenden von vor
    // dem 01.09.2026.
    llmRun: cacheForMatchday?.usage
      ? {
          webSearches: cacheForMatchday.usage.webSearches,
          researchChars: cacheForMatchday.usage.researchChars,
          searchErrors: cacheForMatchday.usage.searchErrors,
          costUsd: cacheForMatchday.usage.costUsd,
        }
      : null,
    // Die UI blendet danach die beiden Aktualisierungsknoepfe aus. Der Weg ueber diese
    // Antwort statt ueber eine NEXT_PUBLIC_-Variable spart einen Konfigurationsschritt
    // beim Hoster -- und einen, den man vergessen kann.
    readOnly: isReadOnlyDeployment(),
    // Angemeldeter Admin: die Knoepfe kommen zurueck, loesen dann aber den Workflow aus.
    // Die Sichtbarkeit ist Bequemlichkeit, die Sperre sitzt in den Routen selbst.
    admin: isAdminRequest(request),
  });
}
