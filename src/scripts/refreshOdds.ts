import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadEnvLocal } from "../data/loadEnv";
import { fetchOddsForFixtures, writeOddsCache } from "../data/oddsApi";

// CLI-Pendant zum "Quoten aktualisieren"-Knopf im Frontend (POST /api/refresh-odds) -- holt
// einmalig frische Quoten fuer den naechsten Spieltag und schreibt sie nach data/odds_cache.json.
loadEnvLocal();

if (!process.env.ODDS_API_KEY) {
  console.error("ODDS_API_KEY ist nicht gesetzt. In .env.local eintragen und erneut versuchen.");
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = join(__dirname, "..", "..", "data", "fixtures.json");

interface Fixture {
  homeTeam: string;
  awayTeam: string;
  date: string;
  matchday: number;
}

const allFixtures: Fixture[] = JSON.parse(readFileSync(FIXTURES_PATH, "utf-8"));
const now = new Date();
const upcoming = allFixtures.filter((f) => new Date(f.date) >= now);
const nextMatchday = upcoming.length > 0 ? Math.min(...upcoming.map((f) => f.matchday)) : null;

if (nextMatchday == null) {
  console.error("Kein kommender Spieltag gefunden.");
  process.exit(1);
}

const fixtures = upcoming.filter((f) => f.matchday === nextMatchday);
const odds = await fetchOddsForFixtures(fixtures);
const cache = writeOddsCache(nextMatchday, odds);

console.log(
  `Spieltag ${nextMatchday}: ${odds.size} von ${fixtures.length} Fixtures mit Quoten gefunden. ` +
    `Gespeichert in data/odds_cache.json (${cache.fetchedAt}).`
);
