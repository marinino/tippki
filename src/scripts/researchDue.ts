// Entscheidet, ob JETZT der Zeitpunkt fuer die Spielkontext-Recherche ist.
//
//   npm run research-due                 -- planmaessige Pruefung
//   npm run research-due -- --force      -- Fenster uebergehen (Handbetrieb)
//   npm run research-due -- --matchday=3 -- einen bestimmten Spieltag pruefen
//   npm run research-due -- --preflight  -- nur berichten, nie ausloesen
//
// Duenner Mantel um decideResearch in src/data/researchWindow.ts -- dort steht die Regel,
// hier nur Uhr, Dateisystem und Ausgabe. Die Trennung existiert, damit die Regel im
// selfCheck gegen feste Zeitpunkte geprueft werden kann statt gegen "jetzt".

import { appendFileSync, readFileSync } from "fs";
import { join } from "path";
import { parseKickoff } from "../data/kickoff";
import { decideResearch, LEAD_MINUTES } from "../data/researchWindow";
import { readLlmCache } from "../llm/llmCache";

interface Fixture {
  homeTeam: string;
  awayTeam: string;
  date: string;
  matchday: number;
}

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  const eq = hit.indexOf("=");
  return eq < 0 ? "" : hit.slice(eq + 1);
}

// GitHub liest Entscheidungen ueber diese Datei aus. Fehlt sie, laeuft das Skript trotzdem
// -- dann ist es einfach ein Bericht auf der Konsole.
function emit(key: string, value: string): void {
  const out = process.env.GITHUB_OUTPUT;
  if (out) appendFileSync(out, `${key}=${value}\n`);
}

const force = flag("force") !== undefined;
const preflight = flag("preflight") !== undefined;
const requested = flag("matchday");

const fixtures: Fixture[] = JSON.parse(
  readFileSync(join(process.cwd(), "data", "fixtures.json"), "utf-8")
);
const cache = readLlmCache();

const decision = decideResearch({
  fixtures,
  now: new Date(),
  cachedMatchday: cache?.matchday ?? null,
  cachedFetchedAt: cache?.fetchedAt ?? null,
  cachedFailures: Object.keys(cache?.failures ?? {}).length,
  force,
  matchday: requested ? Number(requested) : null,
});

// Im Vorschaumodus wird nie ausgeloest -- der Lauf soll nur zeigen, was ansteht.
const effective = preflight ? false : decision.due;

emit("due", String(effective));
if (decision.matchday != null) emit("matchday", String(decision.matchday));
if (decision.firstKickoff) emit("kickoff", decision.firstKickoff.toISOString());
if (decision.target) emit("target", decision.target.toISOString());

console.log(`Jetzt:       ${new Date().toISOString()}`);
console.log(`Spieltag:    ${decision.matchday ?? "—"}`);
console.log(`Faellig:     ${effective ? "ja" : "nein"}${preflight ? " (Vorschau)" : ""}`);
console.log(`Begruendung: ${decision.reason}`);

if (preflight && decision.firstKickoff && decision.target) {
  // Der Wochentag in UTC ist genau das, was der Cron-Ausdruck sieht. Faellt das Fenster auf
  // einen Tag, an dem der Zeitplan nicht laeuft, wuerde der Spieltag stumm durchfallen --
  // deshalb steht die Zahl hier im Bericht, und der Workflow bricht daran ab.
  const utcDay = decision.target.getUTCDay();
  const partien = fixtures.filter((f) => f.matchday === decision.matchday);
  const letzter = Math.max(...partien.map((f) => parseKickoff(f.date).getTime()));

  console.log(`Anpfiff:     ${decision.firstKickoff.toISOString()}`);
  console.log(`Fenster:     ${decision.target.toISOString()} (${LEAD_MINUTES} min vorher)`);
  console.log(`UTC-Wochentag des Fensters: ${utcDay}`);
  console.log(`Partien:     ${partien.length}, letzter Anpfiff ${new Date(letzter).toISOString()}`);

  emit("windowDay", String(utcDay));
}
