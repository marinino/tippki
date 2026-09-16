// Wann die Spielkontext-Recherche faellig ist -- als reine Funktion, ohne Uhr und ohne
// Dateisystem.
//
// Der Zeitplan in GitHub Actions ist eine grobe Kelle: Cron feuert dort nicht puenktlich,
// und vor allem nicht zuverlaessig. Deshalb laeuft der Zeitplan haeufig und stumpf, und
// die Entscheidung faellt hier.
//
// BIS ZUM 16.09.2026 war das Fenster drei Stunden plus/minus zwanzig Minuten, mit der
// Begruendung, ein verspaeteter Tick falle in denselben Korridor wie ein puenktlicher. Das
// setzte voraus, dass die Ticks ueberhaupt kommen. Sie kommen nicht: der Zeitplan
// `*/15 8-16` saehe an einem Freitag 36 Laeufe vor, GitHub hat an den ersten drei
// Spieltags-Freitagen 2, 3 und 2 davon gestartet (nachgesehen ueber die Actions-API). Kein
// geplanter Lauf lag je im 40-Minuten-Fenster. Spieltag 1 und 2 wurden von Hand
// nachgeholt, Spieltag 3 fiel lautlos durch -- beide Laeufe gruen, "nicht faellig", und
// nicht einmal das Basismodell steht im Vorwaerts-Log.
//
// Jetzt ist faellig, wer als ERSTER zwischen dem Sollzeitpunkt (abzueglich der alten
// Toleranz) und der 90-Minuten-Untergrenze kommt. Der Recherchezeitpunkt streut damit um
// bis zu 110 Minuten statt 40. SAISONBETRIEB.md haelt ihn fuer Teil des Eingefrorenen, und
// das bleibt richtig -- aber ein Zeitpunkt, den die Infrastruktur nie trifft, friert nichts
// ein, er verliert nur Spieltage. Die Untergrenze bleibt der eigentliche Schutz: vor ihr
// stehen keine Aufstellungen, jeder Spieltag sieht also weiter dasselbe Informationsregime.

import { firstKickoffOf, nextMatchdayOf } from "./kickoff";

// Sollzeitpunkt drei Stunden vor dem ersten Anpfiff. Faellig ab zwanzig Minuten davor --
// die Toleranz nach vorn bleibt, damit ein frueher Tick nicht verloren geht.
export const LEAD_MINUTES = 180;
export const TOLERANCE_MINUTES = 20;

// Das Basismodell wird schon vor der Recherche protokolliert, sobald der erste Anpfiff so
// nah ist. Grund ist derselbe Befund: faellt die Recherche aus, fehlte bisher auch die
// Basisvorhersage. Kommt die Recherche spaeter doch, ersetzt der Nachtrag die Zeile (siehe
// src/eval/forwardLogRules.ts). 48 Stunden, damit ein Freitagsspieltag am Donnerstag schon
// sicher ist, und nicht frueher, damit die Ergebnisse des Vorspieltags drin sind.
export const BASE_LOG_LEAD_HOURS = 48;

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
  // Von Hand ausgeloest: das Fenster wird uebergangen, die Untergrenze bleibt (seit dem
  // 16.09.2026 auch im Code, vorher nur in diesem Kommentar).
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

  // Die Untergrenze VOR dem Handbetrieb. Bis zum 16.09.2026 stand sie dahinter, und von
  // Hand liess sich damit bis kurz vor Anpfiff recherchieren -- im Widerspruch zum Kommentar
  // an `force` und zu SAISONBETRIEB.md, die beide "die Untergrenze bleibt" sagten. Die
  // Begruendung der Grenze haengt nicht daran, wer ausloest: um diese Zeit stehen die
  // Aufstellungen, und seit forward-log nach einer gescheiterten Recherche nachtragen kann,
  // landete so ein Befund sonst im gepaarten Test.
  if (minutesToKickoff < HARD_FLOOR_MINUTES) {
    return verdict(
      false,
      `Zu spät: Anpfiff in ${Math.round(minutesToKickoff)} Minuten, die Untergrenze liegt bei ` +
        `${HARD_FLOOR_MINUTES}${force ? ", auch von Hand" : ""}. Um diese Zeit stehen die ` +
        "Aufstellungen — ein Spieltag mit diesem Wissen wäre mit den übrigen nicht vergleichbar."
    );
  }

  if (force) {
    return verdict(
      true,
      `Von Hand ausgelöst für Spieltag ${matchday}. Anpfiff in ${Math.round(minutesToKickoff)} ` +
        `Minuten, planmäßig wären es ${LEAD_MINUTES} gewesen.`
    );
  }

  if (offBy < -TOLERANCE_MINUTES) {
    return verdict(
      false,
      `Noch zu früh: ${Math.round(-offBy - TOLERANCE_MINUTES)} Minuten bis zum Fenster ` +
        `(ab ${new Date(target.getTime() - TOLERANCE_MINUTES * 60000).toISOString()}).`
    );
  }

  // Kein "verpasst" mehr zwischen Sollzeitpunkt und Untergrenze -- siehe Kopf der Datei.
  return verdict(
    true,
    `Im Fenster: ${Math.round(Math.abs(offBy))} Minuten ${offBy >= 0 ? "nach" : "vor"} dem ` +
      `Sollzeitpunkt, Anpfiff in ${Math.round(minutesToKickoff)} Minuten.`
  );
}

export interface BaseLogDecision {
  due: boolean;
  matchday: number | null;
  reason: string;
}

// Ob jetzt das Basismodell fuer den naechsten Spieltag protokolliert werden soll --
// unabhaengig davon, ob recherchiert wird.
//
// Faellig, sobald der erste Anpfiff des naechsten Spieltags hoechstens BASE_LOG_LEAD_HOURS
// entfernt ist oder schon laeuft. Letzteres ist der Samstag eines Spieltags: die
// Freitagspartie ist angepfiffen, die uebrigen acht nicht -- die sollen trotzdem noch ins
// Log, wenn es bis dahin keiner geschafft hat. Welche Partien wirklich geschrieben werden,
// entscheidet forward-log (Sperre nach Anpfiff, Idempotenz, Nachtrag).
export function decideBaseLog(
  fixtures: readonly { date: string; matchday: number }[],
  now: Date
): BaseLogDecision {
  const matchday = nextMatchdayOf(fixtures, now);
  if (matchday == null) return { due: false, matchday, reason: "Kein kommender Spieltag." };

  const firstKickoff = firstKickoffOf(fixtures, matchday)!;
  const hours = (firstKickoff.getTime() - now.getTime()) / 3600000;
  if (hours > BASE_LOG_LEAD_HOURS) {
    return {
      due: false,
      matchday,
      reason: `Erster Anpfiff von Spieltag ${matchday} in ${Math.round(hours)} Stunden, protokolliert wird ab ${BASE_LOG_LEAD_HOURS}.`,
    };
  }
  return {
    due: true,
    matchday,
    reason:
      hours >= 0
        ? `Erster Anpfiff von Spieltag ${matchday} in ${Math.round(hours)} Stunden.`
        : `Spieltag ${matchday} läuft, noch nicht angepfiffene Partien werden protokolliert.`,
  };
}
