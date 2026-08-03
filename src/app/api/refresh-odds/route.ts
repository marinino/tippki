import { readFileSync } from "fs";
import { join } from "path";
import { fetchOddsForFixtures, writeOddsCache } from "../../../data/oddsApi";

interface Fixture {
  homeTeam: string;
  awayTeam: string;
  date: string;
  matchday: number;
}

// Manueller Trigger fuer den einzigen Ort, der wirklich odds-api.io-Requests verbraucht (Free-Tier:
// 100/Stunde, 500/Tag) -- bewusst kein automatischer Abruf bei jedem Seitenaufruf.
export async function POST() {
  if (!process.env.ODDS_API_KEY) {
    return Response.json({ error: "ODDS_API_KEY ist nicht gesetzt." }, { status: 400 });
  }

  const fixturesPath = join(process.cwd(), "data", "fixtures.json");
  const allFixtures: Fixture[] = JSON.parse(readFileSync(fixturesPath, "utf-8"));

  const now = new Date();
  const upcoming = allFixtures.filter((f) => new Date(f.date) >= now);
  const nextMatchday = upcoming.length > 0 ? Math.min(...upcoming.map((f) => f.matchday)) : null;
  if (nextMatchday == null) {
    return Response.json({ error: "Kein kommender Spieltag gefunden." }, { status: 400 });
  }

  const fixtures = allFixtures.filter((f) => f.matchday === nextMatchday);

  try {
    const odds = await fetchOddsForFixtures(fixtures);
    const cache = writeOddsCache(nextMatchday, odds);
    return Response.json({
      matchday: nextMatchday,
      fetchedAt: cache.fetchedAt,
      fixturesTotal: fixtures.length,
      fixturesWithOdds: odds.size,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unbekannter Fehler" }, { status: 500 });
  }
}
