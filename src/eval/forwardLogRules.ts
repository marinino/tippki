// Die zwei Regeln, die Schreiben und Auswerten des Vorwaerts-Logs gemeinsam haben muessen.
//
// Sie stehen hier und nicht je einmal in forwardLog.ts und forwardEval.ts, weil sie nur
// zusammen stimmen: forwardLog darf eine zweite Zeile fuer dieselbe Partie genau dann
// schreiben, wenn forwardEval weiss, welche davon zaehlt. Zwei Kopien laufen beim ersten
// Nachschaerfen auseinander, und dann zaehlt eine Partie doppelt oder gar nicht.
//
// Anlass (2026-09-16): der Idempotenzschluessel kannte nur Saison, Spieltag, Hash und
// Paarung. Scheiterte die Recherche, protokollierte der Workflow trotzdem -- gewollt, damit
// die Basisvorhersage nicht verloren geht --, und zwar mit `llm: null`. Eine Reparatur
// zwei Stunden vor Anpfiff lief danach ins Leere: derselbe Hash, derselbe Schluessel,
// alle neun Partien uebersprungen. Der Spieltag war fuer den gepaarten Test verloren,
// obwohl rechtzeitig repariert war.

export interface LogKeyFields {
  season: string;
  matchday: number;
  configHash: string;
  homeTeam: string;
  awayTeam: string;
}

export function logKey(e: LogKeyFields): string {
  return `${e.season}|${e.matchday}|${e.configHash}|${e.homeTeam}|${e.awayTeam}`;
}

export type LogDecision = "neu" | "nachtrag" | "vorhanden";

// Ob fuer eine Partie (bei unveraendertem Hash) eine Zeile geschrieben wird.
//
//   neu        -- noch keine Zeile
//   nachtrag   -- bisher nur Zeilen OHNE Spielkontext, jetzt liegt einer vor
//   vorhanden  -- alles andere
//
// Der Nachtrag ist bewusst einseitig: eine Zeile mit Kontext wird nie durch eine spaetere
// ersetzt, auch nicht durch eine mit anderem Kontext. Sonst liesse sich so lange neu
// recherchieren, bis der Befund gefaellt -- und das Log waere keine Evidenz mehr.
// Die Sperre nach Anpfiff bleibt davon unberuehrt und steht weiter in forwardLog.ts.
export function logDecision(
  existingHasContext: readonly boolean[],
  hasContextNow: boolean
): LogDecision {
  if (existingHasContext.length === 0) return "neu";
  if (existingHasContext.some((had) => had)) return "vorhanden";
  return hasContextNow ? "nachtrag" : "vorhanden";
}

// Spieltage, deren Fehlen im Log bekannt, erklaert und nicht mehr zu beheben ist. Der
// Alarm in forwardLogCheck.ts schweigt fuer sie -- sonst waere er ab dem ersten Ausfall fuer
// immer rot und wuerde nicht mehr gelesen. Ein Eintrag hier ist ein Eingestaendnis, kein
// Schalter: jeder braucht einen Grund.
export const KNOWN_GAPS: readonly { season: string; matchday: number; grund: string }[] = [
  {
    season: "2026",
    matchday: 3,
    grund:
      "Kein geplanter Lauf lag im alten Recherchefenster (180 +/- 20 min); GitHub startete am " +
      "11.09. nur zwei von 36 Ticks. Ohne Faelligkeit lief auch forward-log nicht. Anlass " +
      "fuer das breitere Fenster und das vorgezogene Basis-Log (16.09.2026).",
  },
];

export interface MissingLogEntry {
  matchday: number;
  homeTeam: string;
  awayTeam: string;
  kickoff: string;
}

// Partien, die angepfiffen sind und fuer die in dieser Saison keine einzige Logzeile
// existiert -- gleich unter welchem Hash. Ob eine Zeile Kontext hat, spielt hier keine
// Rolle: der Alarm fragt nur, ob ueberhaupt Evidenz entstanden ist.
export function missingAfterKickoff(
  fixtures: readonly { homeTeam: string; awayTeam: string; date: string; matchday: number }[],
  entries: readonly { season: string; matchday: number; homeTeam: string; awayTeam: string }[],
  season: string,
  now: Date,
  kickoffOf: (date: string) => Date,
  gaps: readonly { season: string; matchday: number }[] = KNOWN_GAPS
): MissingLogEntry[] {
  const logged = new Set(
    entries
      .filter((e) => e.season === season)
      .map((e) => `${e.matchday}|${e.homeTeam}|${e.awayTeam}`)
  );
  const excused = new Set(gaps.filter((g) => g.season === season).map((g) => g.matchday));
  return fixtures
    .filter((f) => kickoffOf(f.date).getTime() <= now.getTime())
    .filter((f) => !excused.has(f.matchday))
    .filter((f) => !logged.has(`${f.matchday}|${f.homeTeam}|${f.awayTeam}`))
    .map((f) => ({ matchday: f.matchday, homeTeam: f.homeTeam, awayTeam: f.awayTeam, kickoff: f.date }));
}

// Lag die Recherche naeher am Anpfiff DIESER Partie als die Untergrenze erlaubt?
//
// Die Untergrenze schuetzt davor, dass ein Befund die Aufstellung schon kennt. Bis zum
// 16.09.2026 liess sich von Hand darunter recherchieren (Punkt 11 der Verbesserungsliste),
// und Spieltag 2 wurde 31 Minuten vor der Freitagspartie recherchiert. Solche Zeilen sind
// mit den uebrigen nicht vergleichbar und gehen nicht in den gepaarten Test.
//
// Gemessen am eigenen Anpfiff, nicht am ersten des Spieltags: fuer die Samstagspartie
// desselben Laufs lagen ueber 20 Stunden dazwischen, sie ist unbelastet.
export function researchTooLate(kickoff: Date, fetchedAt: string, floorMinutes: number): boolean {
  const fetched = new Date(fetchedAt).getTime();
  if (!Number.isFinite(fetched)) return false;
  return (kickoff.getTime() - fetched) / 60000 < floorMinutes;
}

// Welche Zeile je Partie und Hash in die Auswertung geht: die zuletzt geschriebene.
//
// Die Regel ist vor jeder Auswertung festgelegt und haengt an keinem Ergebnis, nur am
// Schreibzeitpunkt. Zusammen mit logDecision heisst "die letzte" immer "die mit Kontext,
// falls es eine gibt" -- eine andere Konstellation kann forwardLog nicht erzeugen. Alle
// Zeilen stammen von vor Anpfiff, dafuer sorgt die Sperre beim Schreiben.
//
// Zeilen ohne loggedAt (es gibt keine, aber das Log ist append-only und ueberlebt jeden
// Codestand) verlieren gegen jede Zeile mit; untereinander gewinnt die spaeter in der Datei.
export function latestPerKey<T extends LogKeyFields & { loggedAt?: string }>(
  entries: readonly T[]
): { kept: T[]; superseded: number } {
  const latest = new Map<string, T>();
  for (const entry of entries) {
    const key = logKey(entry);
    const current = latest.get(key);
    if (!current || (entry.loggedAt ?? "") >= (current.loggedAt ?? "")) {
      latest.set(key, entry);
    }
  }
  return { kept: [...latest.values()], superseded: entries.length - latest.size };
}
