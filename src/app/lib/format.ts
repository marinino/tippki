// Anzeigeformatierung. Alles auf de-DE, weil die Oberflaeche durchgehend deutsch ist.

export function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

export function formatMatchDate(iso: string): string {
  const date = new Date(iso);
  return (
    date.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" }) +
    ", " +
    date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
  );
}

export function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
}

// Die drei Balkenanteile in ganzen Prozent, garantiert auf 100 summierend.
//
// Vorher rundete der Tipps-Tab den Auswaertsanteil als Rest (100 - heim - unentschieden),
// der Simulator dagegen unabhaengig -- dessen drei Segmente konnten deshalb 101% ergeben
// und ragten ueber den Balken hinaus.
export function outcomePercentages(
  homeWinProb: number,
  drawProb: number,
  awayWinProb: number
): { home: number; draw: number; away: number } {
  void awayWinProb;
  const home = Math.round(homeWinProb * 100);
  const draw = Math.round(drawProb * 100);
  return { home, draw, away: 100 - home - draw };
}

// "Sa · 15:30" -- kompakter als das volle Datum und im Spieltagskontext eindeutig,
// weil ein Spieltag nie zwei gleiche Wochentage hat.
export function formatMatchDayTime(iso: string): string {
  const date = new Date(iso);
  return (
    date.toLocaleDateString("de-DE", { weekday: "short" }) +
    " · " +
    date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
  );
}

// Woraus die Quoten entstanden sind. Buchmacherquoten gehen bewusst nie ein -- der
// einzige Unterschied ist, ob der recherchierte Spielkontext gegriffen hat.
export function describeProvenance(llmApplied: boolean): string {
  return llmApplied ? "Modell + Kontext" : "reines Modell";
}

// Dezimalquote, wie ein Buchmacher sie anschreibt. Ab 1000 wird die Stelligkeit unlesbar
// und die genaue Zahl bedeutungslos.
export function odds(fairOdds: number): string {
  if (fairOdds >= 1000) return "999+";
  return num(fairOdds, 2);
}

// Dezimalkomma statt Punkt. Die Oberflaeche formatierte Datumsangaben schon immer
// deutsch, Zahlen aber ueber toFixed() englisch -- in derselben Zeile stand dann
// "Sa · 15:30" neben "1.84 EV".
export function num(value: number, digits: number): string {
  return value.toLocaleString("de-DE", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
