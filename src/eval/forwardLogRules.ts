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
