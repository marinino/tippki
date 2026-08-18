// Preisblatt fuer den naechsten Spieltag.
//
//   npm run predict
//   npm run predict -- --matchday=12
//   npm run predict -- --full        (alle Linien und die Correct-Score-Liste)
//
// Ausgegeben werden faire Quoten, also OHNE Marge. Ein Buchmacher schlaegt darauf noch
// seinen Aufschlag; die Kehrwerte der Zahlen hier summieren je Markt exakt auf 1.

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadEnvLocal } from "../data/loadEnv";
import { loadAllMatches } from "../data/loadMatches";
import { buildLeagueModel } from "../model/teamStrength";
import { predictPipeline } from "../model/predictPipeline";
import { computeXgForm } from "../model/xgForm";
import { formatOdds } from "../model/priceSheet";
import { cacheKey, readLlmCache } from "../llm/llmCache";

loadEnvLocal();

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = join(__dirname, "..", "..", "data", "fixtures.json");

interface Fixture {
  homeTeam: string;
  awayTeam: string;
  date: string;
  matchday: number;
}

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

const full = process.argv.includes("--full");

const allFixtures: Fixture[] = JSON.parse(readFileSync(FIXTURES_PATH, "utf-8"));

const now = new Date();
const upcoming = allFixtures.filter((f) => new Date(f.date) >= now);
const nextMatchday = upcoming.length > 0 ? Math.min(...upcoming.map((f) => f.matchday)) : null;
const matchday = flag("matchday") ? Number(flag("matchday")) : nextMatchday;

if (matchday == null) {
  console.error("Kein kommender Spieltag gefunden.");
  process.exit(0);
}

const fixtures = allFixtures.filter((f) => f.matchday === matchday);
const model = buildLeagueModel(loadAllMatches());

// Nur lesen, nie abrufen. Der LLM-Refresh kostet Geld und laeuft ausschliesslich auf
// ausdruecklichen Knopfdruck (npm run refresh-llm).
const llmCache = readLlmCache();
const llmByFixture = llmCache && llmCache.matchday === matchday ? llmCache.contexts : {};

console.log(`Spieltag ${matchday} -- faire Quoten, ohne Marge\n`);

for (const { homeTeam, awayTeam, date } of fixtures) {
  const matchDate = new Date(date);
  const cachedLlm = llmByFixture[cacheKey(homeTeam, awayTeam)];

  const out = predictPipeline({
    model,
    homeTeam,
    awayTeam,
    homeForm: computeXgForm(homeTeam, matchDate),
    awayForm: computeXgForm(awayTeam, matchDate),
    llmContext: cachedLlm?.context ?? null,
  });

  const p = out.prices;
  const homeLabel = out.homeIsEstimated ? `${homeTeam} (geschätzt, Aufsteiger?)` : homeTeam;
  const awayLabel = out.awayIsEstimated ? `${awayTeam} (geschätzt, Aufsteiger?)` : awayTeam;

  console.log(`${homeLabel} vs ${awayLabel}`);
  console.log(
    `  erwartete Tore ${out.expectedHomeGoals.toFixed(2)} : ${out.expectedAwayGoals.toFixed(2)}` +
      (out.llmAdjustment && !out.llmAdjustment.blocked ? "  (mit Spielkontext)" : "")
  );
  console.log(
    `  1X2       1 ${formatOdds(p.outcome.home)} (${(p.outcome.home.prob * 100).toFixed(1)}%)   ` +
      `X ${formatOdds(p.outcome.draw)} (${(p.outcome.draw.prob * 100).toFixed(1)}%)   ` +
      `2 ${formatOdds(p.outcome.away)} (${(p.outcome.away.prob * 100).toFixed(1)}%)`
  );
  console.log(
    `  Doppelt   1X ${formatOdds(p.doubleChance.homeOrDraw)}   ` +
      `12 ${formatOdds(p.doubleChance.homeOrAway)}   ` +
      `X2 ${formatOdds(p.doubleChance.drawOrAway)}`
  );
  console.log(
    `  BTTS      Ja ${formatOdds(p.bothTeamsToScore.yes)}   Nein ${formatOdds(p.bothTeamsToScore.no)}`
  );

  const totalsShown = full ? p.totals : p.totals.filter((t) => t.line >= 1.5 && t.line <= 3.5);
  console.log(
    `  Torsumme  ` +
      totalsShown
        .map((t) => `${t.line} Ü ${formatOdds(t.over)} / U ${formatOdds(t.under)}`)
        .join("   ")
  );

  const hcShown = full ? p.handicaps : p.handicaps.filter((h) => Math.abs(h.line) <= 1.5);
  console.log(
    `  Handicap  ` +
      hcShown
        .map((h) => `${h.line > 0 ? "+" : ""}${h.line} H ${formatOdds(h.home)} / A ${formatOdds(h.away)}`)
        .join("   ")
  );

  const scores = full ? p.correctScore : p.correctScore.slice(0, 6);
  console.log(
    `  Ergebnis  ` + scores.map((c) => `${c.score} ${formatOdds(c.price)}`).join("   ")
  );
  console.log("");
}

console.log(
  `Die Zahlen stammen ausschliesslich aus Teamstaerken, Formkurve und Spielkontext --\n` +
    `keine Buchmacherquote geht ein. Wie sie sich gegen den Markt schlagen, zeigt\n` +
    `"npm run benchmark".`
);
