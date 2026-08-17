// Diagnose: welche Maerkte liefert odds-api.io fuer ein Bundesliga-Event tatsaechlich?
//
//   npx tsx src/scripts/inspectOddsMarkets.ts
//
// oddsApi.ts:134 sucht hartkodiert nach dem Markt "ML" (Moneyline / 1X2). Die Doku wirbt
// mit "Multiple markets - ML, Spread, Totals, Correct Score, and more", nennt die exakten
// Schluessel aber nicht. Ohne diese Namen laesst sich nicht entscheiden, ob die
// markt-implizierten Lambdas (Over/Under + Asian Handicap) live nutzbar sind oder nur im
// Backtest auf den historischen CSV-Spalten.
//
// Kostet genau zwei API-Requests (Eventliste + ein Event). Schreibt nichts.

import { loadEnvLocal } from "../data/loadEnv";
import { BOOKMAKERS } from "../data/oddsApi";

loadEnvLocal();

const ODDS_API_BASE = "https://api.odds-api.io/v3";
const apiKey = process.env.ODDS_API_KEY;

if (!apiKey) {
  console.error("ODDS_API_KEY fehlt (.env.local). Abbruch, es wird kein Request verbraucht.");
  process.exit(1);
}

interface OddsApiEvent {
  id: number;
  home: string;
  away: string;
  date: string;
}

function truncate(value: unknown, max = 220): string {
  const s = JSON.stringify(value);
  if (s === undefined) return "undefined";
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

const eventsRes = await fetch(
  `${ODDS_API_BASE}/events?apiKey=${apiKey}&sport=football&league=germany-bundesliga&limit=10`
);

if (!eventsRes.ok) {
  console.error(`Eventliste fehlgeschlagen: ${eventsRes.status} ${eventsRes.statusText}`);
  process.exit(1);
}

const events: OddsApiEvent[] = await eventsRes.json();
console.log(`${events.length} Events geliefert.\n`);

if (events.length === 0) {
  console.log("Keine Events -- vermutlich Sommerpause oder falscher League-Slug.");
  process.exit(0);
}

for (const e of events.slice(0, 5)) {
  console.log(`  #${e.id}  ${e.home} vs ${e.away}  ${e.date}`);
}

const event = events[0];
console.log(`\nHole alle Maerkte fuer Event #${event.id} (${event.home} vs ${event.away}) …\n`);

// Der bookmakers-Parameter ist Pflicht (ohne ihn: 400 "Missing bookmakers"), also die
// beiden konfigurierten Buchmacher.
const oddsRes = await fetch(
  `${ODDS_API_BASE}/odds?apiKey=${apiKey}&eventId=${event.id}&bookmakers=${BOOKMAKERS.join(",")}`
);

if (!oddsRes.ok) {
  console.error(`Quotenabruf fehlgeschlagen: ${oddsRes.status} ${oddsRes.statusText}`);
  console.error(await oddsRes.text());
  process.exit(1);
}

const oddsData = await oddsRes.json();

console.log(`Top-Level-Schluessel der Antwort: ${Object.keys(oddsData).join(", ")}\n`);

const bookmakers: Record<string, { name: string; odds: unknown[] }[]> = oddsData.bookmakers ?? {};
const bookmakerNames = Object.keys(bookmakers);
console.log(`${bookmakerNames.length} Buchmacher: ${bookmakerNames.join(", ")}\n`);

const marketsSeen = new Map<string, { bookmakers: Set<string>; sample: unknown }>();

for (const [bookmaker, markets] of Object.entries(bookmakers)) {
  for (const market of markets ?? []) {
    const entry = marketsSeen.get(market.name);
    if (entry) entry.bookmakers.add(bookmaker);
    else marketsSeen.set(market.name, { bookmakers: new Set([bookmaker]), sample: market.odds?.[0] });
  }
}

console.log(`--- ${marketsSeen.size} verschiedene Markt-Schluessel ---\n`);
for (const [name, info] of [...marketsSeen.entries()].sort()) {
  console.log(`  "${name}"  (${info.bookmakers.size} Buchmacher)`);
  console.log(`      Beispiel: ${truncate(info.sample)}`);
}

// Fuer die impliziten Lambdas brauchen wir Totals (Over/Under) und Spread (Asian Handicap),
// oder -- deutlich besser -- direkt eine Correct-Score-Verteilung.
const interesting = [...marketsSeen.keys()].filter((n) =>
  /total|over|under|spread|handicap|ah|correct|score|cs|ou/i.test(n)
);
console.log(
  `\n--- Relevant fuer implizite Lambdas ---\n` +
    (interesting.length > 0 ? `  ${interesting.join(", ")}` : "  KEINE gefunden")
);

// Vollstaendiger Dump der Maerkte, die fuer die Score-Matrix zaehlen. Der Rest der Liste
// ist Beiwerk -- entscheidend ist, ob "Correct Score" die komplette Verteilung liefert
// (dann brauchen wir die Lambdas gar nicht erst aus Over/Under + Handicap zu rekonstruieren).
const FULL_DUMP = ["Correct Score", "Totals", "Spread", "Exact Total Goals", "Winning Margin"];

for (const marketName of FULL_DUMP) {
  console.log(`\n=== Vollstaendig: "${marketName}" ===`);
  let found = false;
  for (const [bookmaker, markets] of Object.entries(bookmakers)) {
    const market = (markets ?? []).find((m) => m.name === marketName);
    if (!market) continue;
    found = true;
    const entries = market.odds ?? [];
    console.log(`  ${bookmaker}: ${entries.length} Eintraege`);
    for (const o of entries) console.log(`      ${JSON.stringify(o)}`);
  }
  if (!found) console.log("  (bei keinem Buchmacher vorhanden)");
}
