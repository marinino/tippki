// Anbindung an odds-api.io (https://docs.odds-api.io), liefert 1X2-Quoten fuer kommende
// Bundesliga-Spiele. Ohne ODDS_API_KEY (oder bei jedem Fehler) liefert dieses Modul einfach
// keine Quoten -- die Vorhersage funktioniert dann unveraendert ohne Markt-Blending weiter.
//
// Bewusst KEIN automatisches Live-Fetching bei jedem Request (siehe frueherer getCachedOddsForFixtures
// in der Git-History): der Free-Tier ist auf 100 Requests/Stunde begrenzt, und ein Seitenaufruf
// soll nicht unbemerkt Kontingent verbrauchen. Stattdessen liest die App aus einer Datei
// (data/odds_cache.json), die nur ueber den manuellen "Quoten aktualisieren"-Knopf (POST
// /api/refresh-odds) neu befuellt wird.

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

export interface BookmakerOdds {
  bookmaker: string;
  oddsHome: number;
  oddsDraw: number;
  oddsAway: number;
}

export interface FixtureOdds {
  bookmakers: BookmakerOdds[];
}

interface FixtureLookup {
  homeTeam: string;
  awayTeam: string;
  date: string;
}

interface OddsApiEvent {
  id: number;
  home: string;
  away: string;
  date: string;
}

interface OddsApiOddsResponse {
  bookmakers: Record<string, { name: string; odds: { home: string; draw: string; away: string }[] }[]>;
}

const ODDS_API_BASE = "https://api.odds-api.io/v3";

// Zwei Buchmacher, wie im odds-api.io-Dashboard ausgewaehlt (Free-Tier erlaubt 2 recreational
// Bookmaker). Genauer Name laut /v3/bookmakers-Liste: "Tipico DE", nicht "Tipico".
export const BOOKMAKERS = ["Bet365", "Tipico DE"];

// League-Slug ist eine Annahme (analog zu "england-premier-league" aus der odds-api.io-Doku) und
// noch nicht gegen echte Daten geprueft. Mit `npx tsx src/scripts/testOdds.ts` verifizieren, sobald
// ein API-Key vorhanden ist -- Events werden notfalls trotzdem per Name+Datum gefunden, auch wenn
// der Slug falsch ist (dann laeuft der Fallback ohne league-Filter).
const BUNDESLIGA_LEAGUE_SLUG = "germany-bundesliga";

// Bekannte Abweichungen zwischen unseren Teamnamen (aus fixtures.json/OpenLigaDB) und den von
// odds-api.io gelieferten Namen, bei denen auch Teilstring-Matching nicht greift (z.B. echte
// Uebersetzungen wie Koeln/Cologne). Mit testOdds.ts pruefen/ergaenzen.
const KNOWN_NAME_OVERRIDES: Record<string, string> = {
  "FC Koln": "Cologne",
};

function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Fuzzy statt exakter Vergleich, weil odds-api.io Teamnamen erfahrungsgemaess anders schreibt
// als OpenLigaDB/football-data.co.uk (z.B. "Bayern Munich" vs. "FC Bayern Munchen", oder
// "Hamburg" vs. "Hamburger SV" -- Teilstring statt exakter Token-Gleichheit, damit sowas matcht).
function namesMatch(ourName: string, apiName: string): boolean {
  const normalizedOur = normalizeTeamName(KNOWN_NAME_OVERRIDES[ourName] ?? ourName);
  const normalizedApi = normalizeTeamName(apiName);
  if (normalizedOur === normalizedApi) return true;

  const ourTokens = normalizedOur.split(" ").filter((t) => t.length > 2);
  const apiTokens = normalizedApi.split(" ").filter((t) => t.length > 2);
  return ourTokens.some((ot) => apiTokens.some((at) => at.includes(ot) || ot.includes(at)));
}

async function fetchEvents(apiKey: string): Promise<OddsApiEvent[]> {
  const withLeague = await fetch(
    `${ODDS_API_BASE}/events?apiKey=${apiKey}&sport=football&league=${BUNDESLIGA_LEAGUE_SLUG}&limit=50`
  );
  if (withLeague.ok) {
    const events: OddsApiEvent[] = await withLeague.json();
    if (events.length > 0) return events;
  }

  // Fallback, falls der League-Slug (noch) nicht stimmt: ungefilterte Fussball-Events abrufen,
  // die Zuordnung passiert dann ueber Teamname+Datum weiter unten.
  const unfiltered = await fetch(`${ODDS_API_BASE}/events?apiKey=${apiKey}&sport=football&limit=200`);
  if (!unfiltered.ok) return [];
  return unfiltered.json();
}

// Holt 1X2-Quoten (beide Buchmacher aus BOOKMAKERS) fuer die uebergebenen Fixtures direkt von
// odds-api.io -- das ist der einzige Ort, der wirklich API-Requests verbraucht. Wird nur vom
// manuellen Refresh (/api/refresh-odds) und den CLI-Scripts aufgerufen, nie automatisch bei
// einem normalen Seitenaufruf. Key im Ergebnis-Map ist "heimteam|auswaertsteam".
export async function fetchOddsForFixtures(fixtures: FixtureLookup[]): Promise<Map<string, FixtureOdds>> {
  const result = new Map<string, FixtureOdds>();
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey || fixtures.length === 0) return result;

  let events: OddsApiEvent[];
  try {
    events = await fetchEvents(apiKey);
  } catch {
    return result;
  }

  for (const fixture of fixtures) {
    const fixtureTime = new Date(fixture.date).getTime();
    const event = events.find(
      (e) =>
        namesMatch(fixture.homeTeam, e.home) &&
        namesMatch(fixture.awayTeam, e.away) &&
        Math.abs(new Date(e.date).getTime() - fixtureTime) < 48 * 60 * 60 * 1000
    );
    if (!event) continue;

    try {
      const oddsRes = await fetch(
        `${ODDS_API_BASE}/odds?apiKey=${apiKey}&eventId=${event.id}&bookmakers=${BOOKMAKERS.join(",")}`
      );
      if (!oddsRes.ok) continue;
      const oddsData: OddsApiOddsResponse = await oddsRes.json();

      const bookmakers: BookmakerOdds[] = [];
      for (const bookmaker of BOOKMAKERS) {
        const ml = oddsData.bookmakers[bookmaker]?.find((m) => m.name === "ML")?.odds[0];
        if (!ml) continue;
        bookmakers.push({ bookmaker, oddsHome: Number(ml.home), oddsDraw: Number(ml.draw), oddsAway: Number(ml.away) });
      }
      if (bookmakers.length > 0) {
        result.set(`${fixture.homeTeam}|${fixture.awayTeam}`, { bookmakers });
      }
    } catch {
      continue;
    }
  }

  return result;
}

interface OddsCacheFile {
  matchday: number;
  fetchedAt: string;
  odds: Record<string, FixtureOdds>;
}

const CACHE_PATH = join(process.cwd(), "data", "odds_cache.json");

export function writeOddsCache(matchday: number, odds: Map<string, FixtureOdds>): OddsCacheFile {
  const cache: OddsCacheFile = {
    matchday,
    fetchedAt: new Date().toISOString(),
    odds: Object.fromEntries(odds),
  };
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  return cache;
}

// Liest die zuletzt manuell abgerufenen Quoten von der Platte. Liefert null, wenn noch nie
// aktualisiert wurde -- die Vorhersage laeuft dann einfach ohne Markt-Blending weiter.
export function readOddsCache(): OddsCacheFile | null {
  if (!existsSync(CACHE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
  } catch {
    return null;
  }
}
