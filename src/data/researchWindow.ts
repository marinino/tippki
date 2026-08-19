// Wann die Spielkontext-Recherche faellig ist -- als reine Funktion, ohne Uhr und ohne
// Dateisystem.
//
// Der Zeitplan in GitHub Actions ist eine grobe Kelle: Cron feuert dort nicht puenktlich,
// sondern irgendwann in den Minuten danach, unter Last auch deutlich spaeter. Ein
// Workflow, der "um 17:30" recherchiert, recherchiert in Wahrheit irgendwann zwischen
// 17:30 und 17:50. Deshalb laeuft der Zeitplan haeufig und stumpf, und die Entscheidung
// faellt hier: ist der erste Anpfiff des naechsten Spieltags rund drei Stunden entfernt?
// Ein verspaeteter Tick faellt dann in denselben Korridor wie ein puenktlicher.
//
// Das Fenster ist bewusst eng. SAISONBETRIEB.md haelt den Recherchezeitpunkt fuer Teil des
// Eingefrorenen: wer mal drei und mal acht Stunden vorher recherchiert, sammelt zwei
// Populationen, die kein Hash auseinanderhaelt. Ein grosszuegiges Fenster waere bequemer
// und richtete genau das an. Faellt ein Spieltag durch, ist das ehrlicher als ein Spieltag
// mit anderem Informationsstand -- und der Admin-Knopf holt ihn bei Bedarf nach.

import { firstKickoffOf, nextMatchdayOf } from "./kickoff";

// Drei Stunden vor dem ersten Anpfiff, plus/minus zwanzig Minuten.
export const LEAD_MINUTES = 180;
export const TOLERANCE_MINUTES = 20;

// Naeher als das geht die Automatik nie von selbst an den Anpfiff heran: Aufstellungen
// erscheinen 60 bis 75 Minuten vorher, und ein Spieltag, der sie kennt, waere mit den
// uebrigen nicht vergleichbar.
export const HARD_FLOOR_MINUTES = 90;

export interface ResearchDecision {
  due: boolean;
  matchday: number | null;
  firstKickoff: Date | null;
  target: Date | null;
  reason: string;
}

export interface ResearchInput {
  fixtures: readonly { date: string; matchday: number }[];
  now: Date;
  // Der Spieltag, den der Cache derzeit abdeckt -- null, wenn es keinen Cache gibt.
  cachedMatchday: number | null;
  cachedFetchedAt?: string | null;
  cachedFailures?: number;
  // Von Hand ausgeloest: das Fenster wird uebergangen, die Untergrenze bleibt.
  force?: boolean;
  // Nur diesen Spieltag pruefen statt des naechsten.
  matchday?: number | null;
}

export function decideResearch(input: ResearchInput): ResearchDecision {
  const { fixtures, now, cachedMatchday, force = false } = input;
  const matchday = input.matchday ?? nextMatchdayOf(fixtures, now);

  const nothing = (reason: string): ResearchDecision => ({
    due: false,
    matchday,
    firstKickoff: null,
    target: null,
    reason,
  });

  if (matchday == null) return nothing("Kein kommender Spieltag — die Saison ist durch.");

  const firstKickoff = firstKickoffOf(fixtures, matchday);
  if (firstKickoff == null) return nothing(`Spieltag ${matchday} enthält keine Partien.`);

  const target = new Date(firstKickoff.getTime() - LEAD_MINUTES * 60000);
  const minutesToKickoff = (firstKickoff.getTime() - now.getTime()) / 60000;
  const offBy = (now.getTime() - target.getTime()) / 60000;

  const verdict = (due: boolean, reason: string): ResearchDecision => ({
    due,
    matchday,
    firstKickoff,
    target,
    reason,
  });

  // Idempotenz vor allem anderen. Ein zweiter Lauf fuer denselben Spieltag ueberschriebe
  // den Cache -- kostet erneut Geld und ersetzt einen Befund, der zum richtigen Zeitpunkt
  // entstanden ist, durch einen spaeteren.
  if (cachedMatchday === matchday && !force) {
    const failures = input.cachedFailures ?? 0;
    return verdict(
      false,
      `Spieltag ${matchday} ist bereits recherchiert (${input.cachedFetchedAt ?? "Zeitpunkt unbekannt"}` +
        (failures > 0 ? `, ${failures} Partien ohne Befund` : "") +
        ")."
    );
  }

  // Nach Anpfiff gibt es nichts mehr zu holen -- auch nicht von Hand. forward-log
  // ueberspringt angepfiffene Partien ohnehin, die Recherche liefe ins Leere.
  if (minutesToKickoff < 0) {
    return verdict(
      false,
      `Spieltag ${matchday} hat bereits begonnen (vor ${Math.round(-minutesToKickoff)} Minuten).`
    );
  }

  if (force) {
    return verdict(
      true,
      `Von Hand ausgelöst für Spieltag ${matchday}. Anpfiff in ${Math.round(minutesToKickoff)} ` +
        `Minuten, planmäßig wären es ${LEAD_MINUTES} gewesen.`
    );
  }

  if (minutesToKickoff < HARD_FLOOR_MINUTES) {
    return verdict(
      false,
      `Zu spät: Anpfiff in ${Math.round(minutesToKickoff)} Minuten, die Untergrenze liegt bei ` +
        `${HARD_FLOOR_MINUTES}. Um diese Zeit stehen die Aufstellungen — ein Spieltag mit ` +
        "diesem Wissen wäre mit den übrigen nicht vergleichbar."
    );
  }

  if (offBy < -TOLERANCE_MINUTES) {
    return verdict(
      false,
      `Noch zu früh: ${Math.round(-offBy)} Minuten bis zum Fenster (${target.toISOString()}).`
    );
  }

  if (offBy > TOLERANCE_MINUTES) {
    return verdict(
      false,
      `Fenster um ${Math.round(offBy)} Minuten verpasst (${target.toISOString()}). Der Spieltag ` +
        "bleibt ohne Spielkontext, sofern er nicht von Hand nachgeholt wird."
    );
  }

  return verdict(
    true,
    `Im Fenster: ${Math.round(Math.abs(offBy))} Minuten ${offBy >= 0 ? "nach" : "vor"} dem ` +
      `Sollzeitpunkt, Anpfiff in ${Math.round(minutesToKickoff)} Minuten.`
  );
}
