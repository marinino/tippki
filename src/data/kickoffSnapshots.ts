// Die Vorhersage bei Anpfiff, eingefroren (VERBESSERUNGEN.md, Punkt 12).
//
// Bis zum 18.11.2026 rechnete /api/predictions jede Partie bei jedem Aufruf neu, auch
// angepfiffene und laengst gespielte -- mit allen bis dahin bekannten Ergebnissen. Wer
// zurueckblaetterte, sah Zahlen, die vor Anpfiff so nie dastanden und die sich mit jedem
// neuen Ergebnis, jedem neuen Fit und jedem Code-Stand weiter verschoben.
//
// Die Regel jetzt: was bei Anpfiff auf der Seite steht, wird nie wieder veraendert.
// Durchsetzbar ist das nur mit einer gespeicherten Kopie -- eine Neuberechnung "mit dem
// Datenstand von damals" waere es nicht, weil sich Code und Modell weiterentwickeln.
//
// Deshalb: zwischen SNAPSHOT_EARLIEST_MINUTES und SNAPSHOT_LATEST_MINUTES vor Anpfiff haelt
// `npm run kickoff-snapshot` (im Spielkontext-Workflow, also vom Taktgeber getaktet) genau
// das fest, was die Seite in diesem Moment zeigt, und haengt es an
// data/kickoff_snapshots.jsonl an. Ab dann zeigt die Seite fuer diese Partie nur noch den
// Schnappschuss -- auch schon in den letzten Minuten vor Anpfiff. Dadurch IST der
// Schnappschuss das, was bei Anpfiff dastand, und nicht bloss eine Annaeherung daran.
//
// Die Datei ist append-only. Eine Zeile wird nie umgeschrieben, und je Partie und
// Anstosszeit wird nie eine zweite geschrieben.

import { existsSync, readFileSync, appendFileSync } from "fs";
import { join } from "path";
import type { DisplayNumbers, LoggedRow } from "./displayPredictions";

// Fruehestens eine Stunde vor Anpfiff: um diese Zeit ist die Recherche des Spieltags durch
// (Untergrenze 90 Minuten vor dem ersten Anpfiff, src/data/researchWindow.ts), es kommt bis
// zum Anpfiff also nichts Neues mehr hinzu ausser Ergebnissen frueherer Partien.
export const SNAPSHOT_EARLIEST_MINUTES = 60;
// Spaetestens eine Viertelstunde vorher: nach dem Commit muss die gehostete Instanz noch
// neu deployen, bevor angepfiffen wird. Ein spaeterer Schnappschuss stuende erst nach
// Anpfiff online, und in den Minuten dazwischen zeigte die Seite etwas anderes als danach.
// Wird das Fenster verpasst, gibt es fuer die Partie keinen Schnappschuss -- nachgeholt
// wird nie, sonst waere er eben nicht der Stand bei Anpfiff.
export const SNAPSHOT_LATEST_MINUTES = 15;

// Ab hier gilt die Regel. Fuer Partien davor gab es keinen Schnappschuss, sie zeigen die
// Zeile aus dem Vorwaerts-Log (siehe chooseDisplaySource). forward-log-check schlaegt erst
// fuer Partien ab diesem Zeitpunkt Alarm.
export const SNAPSHOTS_SINCE = "2026-11-19T00:00:00Z";

export interface KickoffSnapshot {
  frozenAt: string;
  season: string;
  matchday: number;
  homeTeam: string;
  awayTeam: string;
  // Anstosszeit wie in fixtures.json (deutsche Ortszeit, ohne Zone).
  kickoff: string;
  configHash: string;
  numbers: DisplayNumbers;
}

const SNAPSHOT_PATH = join(process.cwd(), "data", "kickoff_snapshots.jsonl");

export function readKickoffSnapshots(path: string = SNAPSHOT_PATH): KickoffSnapshot[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as KickoffSnapshot];
      } catch {
        // Eine kaputte Zeile darf die Anzeige nicht umwerfen.
        return [];
      }
    });
}

export function appendKickoffSnapshot(snapshot: KickoffSnapshot, path: string = SNAPSHOT_PATH): void {
  appendFileSync(path, JSON.stringify(snapshot) + "\n");
}

export function snapshotKey(s: { season: string; homeTeam: string; awayTeam: string; kickoff: string }): string {
  return `${s.season}|${s.homeTeam}|${s.awayTeam}|${s.kickoff}`;
}

export type SnapshotDecision = "faellig" | "zu_frueh" | "zu_spaet" | "vorhanden";

// Ob fuer eine Partie jetzt ein Schnappschuss geschrieben wird.
export function snapshotDecision(
  kickoff: Date,
  now: Date,
  alreadyFrozen: boolean
): SnapshotDecision {
  if (alreadyFrozen) return "vorhanden";
  const minutesToKickoff = (kickoff.getTime() - now.getTime()) / 60000;
  if (minutesToKickoff > SNAPSHOT_EARLIEST_MINUTES) return "zu_frueh";
  if (minutesToKickoff < SNAPSHOT_LATEST_MINUTES) return "zu_spaet";
  return "faellig";
}

export type DisplaySource =
  | { kind: "live" }
  | { kind: "anpfiff"; snapshot: KickoffSnapshot }
  | { kind: "vorwaertslog"; row: LoggedRow }
  | { kind: "fehlt" };

// Was die Seite fuer eine Partie zeigt. Die einzige Stelle, an der das entschieden wird.
//
//   - Schnappschuss mit genau dieser Anstosszeit vorhanden: der Schnappschuss, vor wie nach
//     Anpfiff.
//   - Angepfiffen (Anstosszeit aus fixtures.json vorbei): der LETZTE Schnappschuss der
//     Paarung in dieser Saison, auch wenn er eine andere Anstosszeit traegt -- eine
//     nachtraeglich korrigierte Uhrzeit in fixtures.json darf die eingefrorenen Zahlen nicht
//     wieder freigeben. Ohne Schnappschuss die zuletzt geschriebene Zeile des
//     Vorwaerts-Logs, ohne die gar nichts. Nie live: nach Anpfiff wird nichts mehr gerechnet.
//   - Noch nicht angepfiffen, ohne passenden Schnappschuss: live. Das deckt auch eine
//     verlegte Partie ab, deren alter Schnappschuss nie angepfiffen wurde.
export function chooseDisplaySource(input: {
  season: string;
  fixture: { homeTeam: string; awayTeam: string; date: string };
  kickoff: Date;
  now: Date;
  snapshots: readonly KickoffSnapshot[];
  logRows: readonly LoggedRow[];
}): DisplaySource {
  const { season, fixture, kickoff, now } = input;
  const samePairing = <T extends { season: string; homeTeam: string; awayTeam: string }>(x: T) =>
    x.season === season && x.homeTeam === fixture.homeTeam && x.awayTeam === fixture.awayTeam;

  const pairingSnapshots = input.snapshots.filter(samePairing);
  const exact = pairingSnapshots.find((s) => s.kickoff === fixture.date);
  if (exact) return { kind: "anpfiff", snapshot: exact };

  if (kickoff.getTime() > now.getTime()) return { kind: "live" };

  if (pairingSnapshots.length > 0) {
    return { kind: "anpfiff", snapshot: pairingSnapshots[pairingSnapshots.length - 1] };
  }
  const rows = input.logRows.filter(samePairing);
  if (rows.length > 0) return { kind: "vorwaertslog", row: rows[rows.length - 1] };
  return { kind: "fehlt" };
}

// Partien ab SNAPSHOTS_SINCE, deren Schnappschuss bekanntermassen fehlt. Wie KNOWN_GAPS und
// KNOWN_RESEARCH_GAPS (src/eval/forwardLogRules.ts) ein Eingestaendnis mit Grund, kein
// Schalter: ohne die Liste waere forward-log-check ab dem ersten verpassten Fenster fuer
// immer rot und wuerde nicht mehr gelesen.
//
// Je Partie statt je Spieltag, weil jede Partie ihr eigenes Fenster hat. Faellt die
// Freitagspartie aus, sind Samstag und Sonntag noch zu retten -- ein Eintrag fuer den ganzen
// Spieltag liesse deren Alarm gleich mit verstummen. Erkannt wird die Partie wie beim
// Einfrieren an Saison und Paarung; der Spieltag steht zur Orientierung dabei, und selfCheck
// prueft, dass er stimmt und die Partie wirklich keinen Schnappschuss hat.
export interface SnapshotGap {
  season: string;
  matchday: number;
  homeTeam: string;
  awayTeam: string;
  grund: string;
}

const SPIELTAG_10_OHNE_TAKTGEBER =
  "Der externe Taktgeber (cron-job.org) hatte noch keinen einzigen Lauf gestartet: die " +
  "Actions-API kennt fuer spielkontext.yml seit dem 04.09. kein workflow_dispatch. Am " +
  "Wochenende 20.-22.11.2026 kamen nur sechs Laeufe aus GitHubs eigenem Zeitplan (UTC: Fr " +
  "16:54 und 23:02, Sa 16:05 und 21:37, So 16:11 und 21:54). Einzig So 16:11 lag in einem " +
  "Einfrierfenster, dem von Werder Bremen gegen Hamburg. Aufgefallen am 23.11.2026 in der " +
  "Nachbereitung; der Ergebnis-Workflow war schon seit Fr 22:10 UTC rot.";

export const KNOWN_SNAPSHOT_GAPS: readonly SnapshotGap[] = [
  { season: "2026", matchday: 10, homeTeam: "Bayern Munich", awayTeam: "FC Koln", grund: SPIELTAG_10_OHNE_TAKTGEBER },
  { season: "2026", matchday: 10, homeTeam: "Leverkusen", awayTeam: "Paderborn", grund: SPIELTAG_10_OHNE_TAKTGEBER },
  { season: "2026", matchday: 10, homeTeam: "Ein Frankfurt", awayTeam: "Hoffenheim", grund: SPIELTAG_10_OHNE_TAKTGEBER },
  { season: "2026", matchday: 10, homeTeam: "Union Berlin", awayTeam: "RB Leipzig", grund: SPIELTAG_10_OHNE_TAKTGEBER },
  { season: "2026", matchday: 10, homeTeam: "M'gladbach", awayTeam: "Dortmund", grund: SPIELTAG_10_OHNE_TAKTGEBER },
  { season: "2026", matchday: 10, homeTeam: "Elversberg", awayTeam: "Freiburg", grund: SPIELTAG_10_OHNE_TAKTGEBER },
  { season: "2026", matchday: 10, homeTeam: "Schalke 04", awayTeam: "Stuttgart", grund: SPIELTAG_10_OHNE_TAKTGEBER },
  { season: "2026", matchday: 10, homeTeam: "Augsburg", awayTeam: "Mainz", grund: SPIELTAG_10_OHNE_TAKTGEBER },
];

// Fuer den Alarm: angepfiffene Partien ab SNAPSHOTS_SINCE ohne Schnappschuss, ausser den
// eingestandenen.
export function missingSnapshotsAfterKickoff(
  fixtures: readonly { homeTeam: string; awayTeam: string; date: string; matchday: number }[],
  snapshots: readonly KickoffSnapshot[],
  season: string,
  now: Date,
  kickoffOf: (date: string) => Date,
  gaps: readonly { season: string; homeTeam: string; awayTeam: string }[] = KNOWN_SNAPSHOT_GAPS
): { matchday: number; homeTeam: string; awayTeam: string; kickoff: string }[] {
  const since = new Date(SNAPSHOTS_SINCE).getTime();
  const pairing = (x: { homeTeam: string; awayTeam: string }) => `${x.homeTeam}|${x.awayTeam}`;
  const frozen = new Set(snapshots.filter((s) => s.season === season).map(pairing));
  const excused = new Set(gaps.filter((g) => g.season === season).map(pairing));
  return fixtures
    .filter((f) => {
      const k = kickoffOf(f.date).getTime();
      return k >= since && k <= now.getTime() && !frozen.has(pairing(f)) && !excused.has(pairing(f));
    })
    .map((f) => ({ matchday: f.matchday, homeTeam: f.homeTeam, awayTeam: f.awayTeam, kickoff: f.date }));
}
