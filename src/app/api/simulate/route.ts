import { readFileSync } from "fs";
import { join } from "path";
import { loadAllMatches } from "../../../data/loadMatches";
import { buildLeagueModel } from "../../../model/teamStrength";
import { predictPipeline } from "../../../model/predictPipeline";
import { argmaxCell, toScoreGrid } from "../../../model/scoreMatrix";
import { computeSimulatedForm, type SimpleResult } from "../../../model/simulateForm";

// 0 bis 5 Tore je Seite -- gleiche Aufloesung wie im Tipps-Tab.
const DISPLAY_MAX_GOALS = 5;

interface Fixture {
  homeTeam: string;
  awayTeam: string;
  date: string;
  matchday: number;
}

interface StandingsRow {
  position: number;
  team: string;
  logo: string | null;
  matches: number;
  won: number;
  draw: number;
  lost: number;
  goals: number;
  opponentGoals: number;
  goalDiff: number;
  points: number;
}

function computeStandings(results: SimpleResult[], logosByTeam: Record<string, string>): StandingsRow[] {
  const stats = new Map<
    string,
    { played: number; won: number; draw: number; lost: number; goals: number; opponentGoals: number }
  >();

  function ensure(team: string) {
    if (!stats.has(team)) stats.set(team, { played: 0, won: 0, draw: 0, lost: 0, goals: 0, opponentGoals: 0 });
    return stats.get(team)!;
  }

  for (const r of results) {
    const home = ensure(r.homeTeam);
    const away = ensure(r.awayTeam);
    home.played++;
    away.played++;
    home.goals += r.homeGoals;
    home.opponentGoals += r.awayGoals;
    away.goals += r.awayGoals;
    away.opponentGoals += r.homeGoals;
    if (r.homeGoals > r.awayGoals) {
      home.won++;
      away.lost++;
    } else if (r.homeGoals < r.awayGoals) {
      away.won++;
      home.lost++;
    } else {
      home.draw++;
      away.draw++;
    }
  }

  const rows = [...stats.entries()].map(([team, s]) => ({
    team,
    logo: logosByTeam[team] ?? null,
    matches: s.played,
    won: s.won,
    draw: s.draw,
    lost: s.lost,
    goals: s.goals,
    opponentGoals: s.opponentGoals,
    goalDiff: s.goals - s.opponentGoals,
    points: s.won * 3 + s.draw,
  }));

  rows.sort((a, b) => b.points - a.points || b.goalDiff - a.goalDiff || b.goals - a.goals);
  return rows.map((row, i) => ({ position: i + 1, ...row }));
}

// Liefert Modell-Vorhersagen fuer einen Spieltag der Saison-Simulation, plus die
// Tabelle aus den bisher im Frontend eingetragenen Ergebnissen. Team-Staerke ist wie im
// Produktivmodell aus allen bisherigen echten Saisons trainiert und bleibt waehrend der ganzen
// Simulation fix -- nur die Form (computeSimulatedForm, Tordifferenz statt echtem xG) aktualisiert
// sich mit den eingetragenen Ergebnissen.
export async function POST(request: Request) {
  const body: { matchday: number; resultsSoFar: SimpleResult[] } = await request.json();
  const { matchday, resultsSoFar } = body;

  const fixturesPath = join(process.cwd(), "data", "fixtures.json");
  const allFixtures: Fixture[] = JSON.parse(readFileSync(fixturesPath, "utf-8"));
  const logosPath = join(process.cwd(), "data", "teamLogos.json");
  const logosByTeam: Record<string, string> = JSON.parse(readFileSync(logosPath, "utf-8"));

  const totalMatchdays = Math.max(...allFixtures.map((f) => f.matchday));
  const fixtures = allFixtures.filter((f) => f.matchday === matchday);

  const matches = loadAllMatches();
  const model = buildLeagueModel(matches);

  const predictions = fixtures.map(({ homeTeam, awayTeam, date }) => {
    const out = predictPipeline({
      model,
      homeTeam,
      awayTeam,
      homeForm: computeSimulatedForm(homeTeam, resultsSoFar),
      awayForm: computeSimulatedForm(awayTeam, resultsSoFar),
    });

    return {
      homeTeam,
      awayTeam,
      date,
      homeLogo: logosByTeam[homeTeam] ?? null,
      awayLogo: logosByTeam[awayTeam] ?? null,
      scoreGrid: toScoreGrid(out.matrix, DISPLAY_MAX_GOALS),
      expectedHomeGoals: out.expectedHomeGoals,
      expectedAwayGoals: out.expectedAwayGoals,
      homeWinProb: out.probs.homeWinProb,
      drawProb: out.probs.drawProb,
      awayWinProb: out.probs.awayWinProb,
      mostLikelyScore: argmaxCell(out.matrix),
      prices: out.prices,
      homeIsEstimated: out.homeIsEstimated,
      awayIsEstimated: out.awayIsEstimated,
    };
  });

  const table = computeStandings(resultsSoFar, logosByTeam);

  return Response.json({ matchday, totalMatchdays, predictions, table });
}
