// Schlaegt Alarm, wenn eine angepfiffene Partie nicht im Vorwaerts-Log steht.
//
//   npm run forward-log-check
//
// Exit 1, sobald eine fehlt -- der Workflow wird dann rot, und GitHub meldet es.
//
// Anlass (16.09.2026): Spieltag 3 fehlte komplett, und niemand hat es gemerkt. Der
// Recherche-Workflow war zweimal gruen gelaufen, jeweils mit "nicht faellig", und ein
// nicht faelliger Lauf ist kein Fehler. Die Vorschau in der Nachbereitung prueft, ob der
// Zeitplan das Fenster abdeckt, nicht, ob GitHub ihn ausfuehrt. Diese Pruefung schaut
// deshalb nicht auf Zeitplaene, sondern auf das Ergebnis: steht fuer jede angepfiffene
// Partie etwas im Log?
//
// Bekannte, nicht mehr behebbare Luecken stehen mit Grund in KNOWN_GAPS
// (src/eval/forwardLogRules.ts).

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { parseKickoff } from "../data/kickoff";
import { FORWARD_SEASON } from "../eval/splits";
import { KNOWN_GAPS, missingAfterKickoff } from "../eval/forwardLogRules";

const DATA_DIR = join(process.cwd(), "data");
const LOG_PATH = join(DATA_DIR, "forward_log.jsonl");

const fixtures = JSON.parse(readFileSync(join(DATA_DIR, "fixtures.json"), "utf-8"));
const entries = existsSync(LOG_PATH)
  ? readFileSync(LOG_PATH, "utf-8")
      .split("\n")
      .filter((line) => line.trim())
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      })
  : [];

const missing = missingAfterKickoff(fixtures, entries, FORWARD_SEASON, new Date(), parseKickoff);

const gaps = KNOWN_GAPS.filter((g) => g.season === FORWARD_SEASON);
if (gaps.length > 0) {
  console.log(`Bekannte Luecken (kein Alarm): Spieltag ${gaps.map((g) => g.matchday).join(", ")}`);
}

if (missing.length === 0) {
  console.log("Jede angepfiffene Partie steht im Vorwaerts-Log.");
  process.exit(0);
}

console.log(`\n${missing.length} angepfiffene Partie(n) ohne eine einzige Logzeile:\n`);
for (const m of missing) {
  console.log(`  Spieltag ${m.matchday}: ${m.homeTeam} vs ${m.awayTeam} (Anpfiff ${m.kickoff})`);
}
console.log(
  `\nDiese Vorhersagen lassen sich nicht nachholen -- nach Anpfiff wird nichts mehr\n` +
    `protokolliert. Laeuft der Spieltag noch, sofort "Spielkontext" von Hand starten, damit\n` +
    `wenigstens die restlichen Partien ins Log kommen. Danach die Ursache klaeren und die\n` +
    `Luecke mit Grund in KNOWN_GAPS (src/eval/forwardLogRules.ts) eintragen.`
);
process.exit(1);
