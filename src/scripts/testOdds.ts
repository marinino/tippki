import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadEnvLocal } from "../data/loadEnv";
import { fetchOddsForFixtures } from "../data/oddsApi";

// Diagnose-Script fuer die odds-api.io-Anbindung: zeigt fuer den naechsten Spieltag, welche
// Fixtures eine passende Quote gefunden haben und welche nicht (z.B. wegen falschem
// League-Slug oder abweichender Teamnamen -- dann KNOWN_NAME_OVERRIDES in oddsApi.ts ergaenzen).
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
const fixtures = upcoming.filter((f) => f.matchday === nextMatchday);

console.log(`Teste ${fixtures.length} Fixtures aus Spieltag ${nextMatchday}...\n`);

const odds = await fetchOddsForFixtures(fixtures);

for (const fixture of fixtures) {
  const key = `${fixture.homeTeam}|${fixture.awayTeam}`;
  const found = odds.get(key);
  if (found) {
    const odds = found.bookmakers
      .map((b) => `${b.bookmaker}: ${b.oddsHome} / ${b.oddsDraw} / ${b.oddsAway}`)
      .join("  |  ");
    console.log(`✓ ${fixture.homeTeam} vs ${fixture.awayTeam}: ${odds}`);
  } else {
    console.log(`✗ ${fixture.homeTeam} vs ${fixture.awayTeam}: KEINE Quote gefunden`);
  }
}

console.log(`\n${odds.size} von ${fixtures.length} Fixtures gefunden.`);
