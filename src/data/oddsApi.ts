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

// Entvigte Marktwahrscheinlichkeiten je Linie, ueber alle Buchmacher gemittelt, die die
// Linie anbieten. Nur Halblinien (x.5): dort ist die Wette echt zweiwertig, es gibt kein
// Push und keine Aufteilung auf Nachbarlinien -- nur dann ist zweiwertiges Entvigen korrekt.
export interface TotalsPoint {
  line: number;
  overProb: number;
  bookmakerCount: number;
}

export interface SpreadPoint {
  line: number;
  homeProb: number;
  bookmakerCount: number;
}

export interface FixtureOdds {
  bookmakers: BookmakerOdds[];
  // Aus dem Markt "Totals": legt die Randverteilung der Torsumme fest.
  totals?: TotalsPoint[];
  // Aus dem Markt "Spread" (Asian Handicap): legt die Randverteilung der Tordifferenz fest.
  spread?: SpreadPoint[];
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

// Die Antwort enthaelt pro Buchmacher eine Liste von Maerkten mit sehr unterschiedlichen
// Eintragsformen (siehe npm run inspect-odds-markets): "ML" hat home/draw/away, "Totals"
// hat hdp/over/under, "Spread" hat hdp und je nach Vorzeichen nur home ODER nur away.
interface OddsApiEntry {
  home?: string;
  draw?: string;
  away?: string;
  over?: string;
  under?: string;
  hdp?: number;
}

interface OddsApiOddsResponse {
  bookmakers: Record<string, { name: string; odds: OddsApiEntry[] }[]>;
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
        if (!ml?.home || !ml.draw || !ml.away) continue;
        bookmakers.push({ bookmaker, oddsHome: Number(ml.home), oddsDraw: Number(ml.draw), oddsAway: Number(ml.away) });
      }
      if (bookmakers.length > 0) {
        result.set(`${fixture.homeTeam}|${fixture.awayTeam}`, {
          bookmakers,
          totals: extractTotals(oddsData),
          spread: extractSpread(oddsData),
        });
      }
    } catch {
      continue;
    }
  }

  return result;
}

function isHalfLine(line: number | undefined): line is number {
  return typeof line === "number" && Math.abs(line % 1) === 0.5;
}

function averageByLine(
  samples: { line: number; prob: number }[]
): { line: number; prob: number; bookmakerCount: number }[] {
  const grouped = new Map<number, number[]>();
  for (const s of samples) {
    if (!Number.isFinite(s.prob) || s.prob <= 0 || s.prob >= 1) continue;
    const existing = grouped.get(s.line);
    if (existing) existing.push(s.prob);
    else grouped.set(s.line, [s.prob]);
  }
  return [...grouped.entries()]
    .map(([line, probs]) => ({
      line,
      prob: probs.reduce((sum, p) => sum + p, 0) / probs.length,
      bookmakerCount: probs.length,
    }))
    .sort((a, b) => a.line - b.line);
}

function devigTwoWay(oddsA: number, oddsB: number): number {
  const rawA = 1 / oddsA;
  const rawB = 1 / oddsB;
  return rawA / (rawA + rawB);
}

// "Totals" liefert je Linie {hdp, over, under}. Bet365 quotiert ueber 20 Linien, Tipico
// nur zwei -- gemittelt wird deshalb auf der Wahrscheinlichkeitsskala je Linie, damit
// eine duenn besetzte Linie nicht dasselbe Gewicht bekommt wie eine dicht besetzte.
function extractTotals(oddsData: OddsApiOddsResponse): TotalsPoint[] | undefined {
  const samples: { line: number; prob: number }[] = [];

  for (const markets of Object.values(oddsData.bookmakers ?? {})) {
    for (const market of markets ?? []) {
      if (market.name !== "Totals" && market.name !== "Goals Over/Under") continue;
      for (const entry of market.odds ?? []) {
        if (!isHalfLine(entry.hdp) || !entry.over || !entry.under) continue;
        samples.push({ line: entry.hdp, prob: devigTwoWay(Number(entry.over), Number(entry.under)) });
      }
    }
  }

  const averaged = averageByLine(samples);
  if (averaged.length < 2) return undefined;
  return averaged.map((a) => ({ line: a.line, overProb: a.prob, bookmakerCount: a.bookmakerCount }));
}

// "Spread" ist unangenehmer als Totals: die API liefert pro Linie nur EINE Seite
// ({hdp:-1.5, home:"1.725"} und getrennt {hdp:1.5, away:"2.075"}). Die Gegenseite einer
// Heimlinie -x steht unter der Auswaertslinie +x. Erst zusammengefuehrt ergibt das eine
// zweiwertige Wette, die sich entvigen laesst.
function extractSpread(oddsData: OddsApiOddsResponse): SpreadPoint[] | undefined {
  const samples: { line: number; prob: number }[] = [];

  for (const markets of Object.values(oddsData.bookmakers ?? {})) {
    for (const market of markets ?? []) {
      if (market.name !== "Spread") continue;

      const homeOdds = new Map<number, number>();
      const awayOdds = new Map<number, number>();
      for (const entry of market.odds ?? []) {
        if (!isHalfLine(entry.hdp)) continue;
        if (entry.home) homeOdds.set(entry.hdp, Number(entry.home));
        if (entry.away) awayOdds.set(entry.hdp, Number(entry.away));
      }

      for (const [line, odds] of homeOdds) {
        const opposite = awayOdds.get(-line);
        if (!opposite) continue;
        samples.push({ line, prob: devigTwoWay(odds, opposite) });
      }
    }
  }

  const averaged = averageByLine(samples);
  if (averaged.length < 2) return undefined;
  return averaged.map((a) => ({ line: a.line, homeProb: a.prob, bookmakerCount: a.bookmakerCount }));
}

interface OddsCacheFile {
  // Erhoehen, wenn sich die Struktur aendert -- readOddsCache verwirft dann alte Dateien,
  // statt mit halb befuellten Feldern weiterzurechnen.
  version?: number;
  matchday: number;
  fetchedAt: string;
  odds: Record<string, FixtureOdds>;
}

const ODDS_CACHE_VERSION = 2;

const CACHE_PATH = join(process.cwd(), "data", "odds_cache.json");

export function writeOddsCache(matchday: number, odds: Map<string, FixtureOdds>): OddsCacheFile {
  const cache: OddsCacheFile = {
    version: ODDS_CACHE_VERSION,
    matchday,
    fetchedAt: new Date().toISOString(),
    odds: Object.fromEntries(odds),
  };
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  return cache;
}

// Liest die zuletzt manuell abgerufenen Quoten von der Platte. Liefert null, wenn noch nie
// aktualisiert wurde -- die Vorhersage laeuft dann einfach ohne Markt-Blending weiter.
//
// Aeltere Cache-Dateien (ohne version, also ohne Totals/Spread) bleiben nutzbar: die
// 1X2-Quoten stehen darin unveraendert, die neuen Felder sind schlicht undefined und die
// zusaetzlichen Bedingungen entfallen. Kein Grund, den Nutzer zu einem Refresh zu zwingen.
export function readOddsCache(): OddsCacheFile | null {
  if (!existsSync(CACHE_PATH)) return null;
  try {
    const parsed: OddsCacheFile = JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
    if (!parsed || typeof parsed.matchday !== "number" || !parsed.odds) return null;
    return parsed;
  } catch {
    return null;
  }
}
