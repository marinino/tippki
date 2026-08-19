// Anstosszeiten eindeutig machen.
//
// In data/fixtures.json steht "2026-08-28T20:30:00" -- ohne Offset, ohne Z. `new Date()`
// liest so einen String als Ortszeit der ausfuehrenden Maschine. Solange alles auf einem
// Rechner in Europe/Berlin lief, stimmte das zufaellig. Sobald es das nicht mehr tut --
// ein CI-Runner und eine Serverless-Funktion laufen beide in UTC --, verschiebt sich jeder
// Anpfiff um ein bis zwei Stunden, und zwar still.
//
// Die gefaehrlichste Stelle ist nicht die Anzeige, sondern forwardLog.ts: dort entscheidet
// `kickoff < now`, ob eine Partie schon angepfiffen ist und deshalb NICHT mehr protokolliert
// werden darf. Unter UTC sieht ein laufendes Spiel zwei Stunden lang noch zukuenftig aus.
// Das Log ist append-only -- eine so entstandene Zeile bliebe fuer immer darin stehen und
// waere eine Vorhersage, die nach Anpfiff abgegeben wurde.
//
// Ein fester Offset ist keine Loesung: die Saison laeuft ueber beide Zeitumstellungen, im
// August gilt +02:00, im Dezember +01:00.

// Die Zeitzone, in der die Anstosszeiten in fixtures.json notiert sind. Bundesliga --
// die Spielansetzung ist deutsche Ortszeit, unabhaengig davon, wer sie liest.
export const FIXTURE_TIMEZONE = "Europe/Berlin";

const NAIVE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;
const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/;

const PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: FIXTURE_TIMEZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

// Wie weit laeuft die Uhr in Berlin zu diesem Zeitpunkt der UTC voraus, in Minuten?
// Der Weg ueber Intl statt ueber eine Tabelle: die Zeitzonendatenbank steckt schon in der
// Laufzeit, und sie kennt auch Regeln, die sich noch aendern.
function offsetMinutesAt(instantMs: number): number {
  const p: Record<string, string> = {};
  for (const part of PARTS.formatToParts(new Date(instantMs))) {
    if (part.type !== "literal") p[part.type] = part.value;
  }
  const asIfUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second)
  );
  return (asIfUtc - instantMs) / 60000;
}

// Liest eine Anstosszeit als deutschen Wandkalender und liefert den echten Zeitpunkt.
//
// Traegt der String bereits eine Zone ("...Z" oder "...+02:00"), ist er von sich aus
// eindeutig und wird unveraendert uebernommen -- so bleibt der Weg offen, fixtures.json
// spaeter auf absolute Zeitstempel umzustellen, ohne hier etwas anzufassen.
export function parseKickoff(value: string): Date {
  if (HAS_ZONE.test(value)) {
    const withZone = new Date(value);
    if (Number.isNaN(withZone.getTime())) {
      throw new Error(`Unlesbare Anstosszeit: "${value}"`);
    }
    return withZone;
  }

  const m = NAIVE.exec(value.trim());
  if (!m) throw new Error(`Unlesbare Anstosszeit: "${value}"`);

  const wall = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    m[6] ? Number(m[6]) : 0
  );

  // Zwei Schritte. Der erste Offset wird an der Wandzeit abgelesen, als waere sie UTC --
  // in der Nacht einer Zeitumstellung kann das die falsche Seite treffen. Der zweite
  // Schritt liest ihn am so gewonnenen Zeitpunkt erneut ab und trifft dann die richtige.
  // Die eine nicht existierende Stunde im Maerz und die doppelte im Oktober bleiben
  // mehrdeutig; Anstosszeiten liegen nie darin.
  const firstGuess = wall - offsetMinutesAt(wall) * 60000;
  return new Date(wall - offsetMinutesAt(firstGuess) * 60000);
}

// Der naechste Spieltag: der des naechsten Anpfiffs, chronologisch.
//
// Bewusst hier und nicht viermal einzeln -- vier Kopien derselben Zeile waren der Grund,
// warum die Zeitzonenfrage an vier Stellen gleichzeitig falsch war.
//
// Die naheliegende Fassung waere "die kleinste Spieltagsnummer, die noch Partien vor sich
// hat". Sie geht bei einer Absetzung schief, und Absetzungen kommen vor: wird eine Partie
// des 5. Spieltags auf Dezember verlegt, bliebe der 5. bis dahin der "naechste" -- und die
// Automatik berechnete ihr Fenster aus dem Dezembertermin, faende es nie faellig und
// liesse die Spieltage 6 bis 15 unrecherchiert durchlaufen. Chronologisch gedacht ist der
// naechste Spieltag der, dessen Partie als naechstes angepfiffen wird; die verlegte bleibt
// beim 5. und wurde dort seinerzeit mitprotokolliert.
export function nextMatchdayOf(
  fixtures: readonly { date: string; matchday: number }[],
  now: Date = new Date()
): number | null {
  let earliest: { time: number; matchday: number } | null = null;
  for (const f of fixtures) {
    const time = parseKickoff(f.date).getTime();
    if (time < now.getTime()) continue;
    // Bei gleichem Anpfiff die kleinere Spieltagsnummer -- sonst haenge das Ergebnis an
    // der Reihenfolge in der Datei.
    if (
      earliest === null ||
      time < earliest.time ||
      (time === earliest.time && f.matchday < earliest.matchday)
    ) {
      earliest = { time, matchday: f.matchday };
    }
  }
  return earliest?.matchday ?? null;
}

// Der erste Anpfiff eines Spieltags -- der Zeitpunkt, an dem sich die Recherche bemisst.
export function firstKickoffOf(
  fixtures: readonly { date: string; matchday: number }[],
  matchday: number
): Date | null {
  const times = fixtures
    .filter((f) => f.matchday === matchday)
    .map((f) => parseKickoff(f.date).getTime());
  return times.length > 0 ? new Date(Math.min(...times)) : null;
}
