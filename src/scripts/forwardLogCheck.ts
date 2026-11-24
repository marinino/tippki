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
// Bekannte, nicht mehr behebbare Luecken stehen mit Grund in KNOWN_GAPS und
// KNOWN_RESEARCH_GAPS (src/eval/forwardLogRules.ts) sowie, je Partie, in KNOWN_SNAPSHOT_GAPS
// (src/data/kickoffSnapshots.ts).

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { parseKickoff } from "../data/kickoff";
import { FORWARD_SEASON } from "../eval/splits";
import {
  KNOWN_GAPS,
  KNOWN_RESEARCH_GAPS,
  missingAfterKickoff,
  missingResearchAfterKickoff,
} from "../eval/forwardLogRules";
import {
  KNOWN_SNAPSHOT_GAPS,
  missingSnapshotsAfterKickoff,
  readKickoffSnapshots,
} from "../data/kickoffSnapshots";

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

const now = new Date();
const missing = missingAfterKickoff(fixtures, entries, FORWARD_SEASON, now, parseKickoff);
const unresearched = missingResearchAfterKickoff(fixtures, entries, FORWARD_SEASON, now, parseKickoff);
// Seit dem 19.11.2026: jede angepfiffene Partie soll einen Anpfiff-Schnappschuss haben
// (src/data/kickoffSnapshots.ts). Fehlt er, zeigt die Seite fuer immer nur die Logzeile.
const unfrozen = missingSnapshotsAfterKickoff(fixtures, readKickoffSnapshots(), FORWARD_SEASON, now, parseKickoff);

const gaps = KNOWN_GAPS.filter((g) => g.season === FORWARD_SEASON);
if (gaps.length > 0) {
  console.log(`Bekannte Luecken im Log (kein Alarm): Spieltag ${gaps.map((g) => g.matchday).join(", ")}`);
}
const researchGaps = KNOWN_RESEARCH_GAPS.filter((g) => g.season === FORWARD_SEASON);
if (researchGaps.length > 0) {
  console.log(
    `Bekannte Spieltage ohne Recherche (kein Alarm): ${researchGaps.map((g) => g.matchday).join(", ")}`
  );
}
const snapshotGaps = KNOWN_SNAPSHOT_GAPS.filter((g) => g.season === FORWARD_SEASON);
if (snapshotGaps.length > 0) {
  const perMatchday = new Map<number, number>();
  for (const g of snapshotGaps) perMatchday.set(g.matchday, (perMatchday.get(g.matchday) ?? 0) + 1);
  const parts = [...perMatchday].map(([md, n]) => `Spieltag ${md}: ${n} ${n === 1 ? "Partie" : "Partien"}`);
  console.log(`Bekannte Partien ohne Schnappschuss (kein Alarm): ${parts.join(", ")}`);
}

if (missing.length === 0) {
  console.log("Jede angepfiffene Partie steht im Vorwaerts-Log.");
} else {
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
}

if (unresearched.length === 0) {
  console.log("Jeder angepfiffene Spieltag ist recherchiert.");
} else {
  console.log(`\n${unresearched.length} angepfiffene(r) Spieltag(e) ohne Spielkontext:\n`);
  for (const m of unresearched) {
    console.log(`  Spieltag ${m.matchday} (erster Anpfiff ${m.firstKickoff})`);
  }
  console.log(
    `\nDie Recherche lief nicht oder scheiterte. Nachholen geht nur fuer Partien, die noch\n` +
      `mindestens 90 Minuten entfernt sind ("Spielkontext" von Hand starten). Ursache pruefen:\n` +
      `laeuft der externe Taktgeber (SAISONBETRIEB.md, "Taktgeber")? Gibt es im Lauf einen\n` +
      `Recherchefehler? Danach den Spieltag mit Grund in KNOWN_RESEARCH_GAPS\n` +
      `(src/eval/forwardLogRules.ts) eintragen.`
  );
}

if (unfrozen.length === 0) {
  console.log("Jede angepfiffene Partie (ab 19.11.2026) ist bei Anpfiff eingefroren.");
} else {
  console.log(`\n${unfrozen.length} angepfiffene Partie(n) ohne Anpfiff-Schnappschuss:\n`);
  for (const m of unfrozen) {
    console.log(`  Spieltag ${m.matchday}: ${m.homeTeam} vs ${m.awayTeam} (Anpfiff ${m.kickoff})`);
  }
  console.log(
    `\nNachholen geht nicht -- ein spaeterer Schnappschuss waere nicht der Stand bei Anpfiff.\n` +
      `Die Seite zeigt fuer diese Partien die Zeile aus dem Vorwaerts-Log. Ursache pruefen:\n` +
      `kam zwischen 60 und 15 Minuten vor Anpfiff ein Tick des Taktgebers an\n` +
      `(SAISONBETRIEB.md, "Taktgeber")? Stehen unter Actions -> Spielkontext ueberhaupt Laeufe\n` +
      `mit dem Ausloeser workflow_dispatch? Ist der Schritt "Anpfiff einfrieren" rot? Danach\n` +
      `die Partien mit Grund in KNOWN_SNAPSHOT_GAPS (src/data/kickoffSnapshots.ts) eintragen.`
  );
}

process.exit(missing.length > 0 || unresearched.length > 0 || unfrozen.length > 0 ? 1 : 0);
