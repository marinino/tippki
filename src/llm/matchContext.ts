// Der Vertrag mit dem LLM.
//
// Zentrale Entscheidung: das LLM gibt **Fakten** aus, keine Zahlen. Es sagt "Torhüter X
// fehlt, bestätigt, Schlüsselspieler", nicht "senke die Torerwartung um 0.08". Die
// Umrechnung in eine Lambda-Korrektur macht unser Code (factMapping.ts).
//
// Drei Gründe:
//
//   1. LLMs kalibrieren Zahlen unzuverlässig. Ob ein fehlender Innenverteidiger 5% oder
//      15% Torerwartung kostet, ist eine statistische Frage -- keine, die ein Sprachmodell
//      aus einem Verletzungsbericht ableiten kann.
//   2. Die Umrechnungstabelle bleibt tunebar, OHNE das LLM erneut zu befragen. Der teure
//      und nicht wiederholbare Teil (die Recherche) wird konserviert, der billige Teil
//      (die Gewichtung) bleibt anpassbar, sobald Vorwaertsdaten da sind.
//   3. Auditierbarkeit: im Vorwaerts-Log steht, WAS gefunden wurde, nicht nur eine Zahl.
//
// Nebeneffekt, der die Entscheidung bestaetigt: Structured Outputs unterstuetzen keine
// numerischen Schranken (`minimum`/`maximum` werden nicht durchgesetzt), Enums dagegen
// schon. Ein rein enum-basiertes Schema ist also vollstaendig erzwingbar, ein Schema mit
// begrenzten Zahlen nicht.

export const TEAM_SIDES = ["home", "away"] as const;
export type TeamSide = (typeof TEAM_SIDES)[number];

export const FACT_CATEGORIES = [
  "absence", // Spieler fehlt (Verletzung, Sperre, Nationalmannschaft)
  "return", // Schluesselspieler kommt zurueck
  "congestion", // Belastung: Europapokal-Mittwoch, kurze Regeneration
  "manager", // Trainerwechsel in den letzten Wochen
  "motivation", // Abstiegskampf, Titel entschieden, nichts mehr zu holen
] as const;
export type FactCategory = (typeof FACT_CATEGORIES)[number];

export const PLAYER_ROLES = [
  "goalkeeper",
  "defender",
  "midfielder",
  "forward",
  "coach",
  "team", // betrifft die Mannschaft als Ganzes (Belastung, Motivation)
] as const;
export type PlayerRole = (typeof PLAYER_ROLES)[number];

export const IMPORTANCE_LEVELS = ["key", "regular", "squad"] as const;
export type Importance = (typeof IMPORTANCE_LEVELS)[number];

export const CERTAINTY_LEVELS = ["confirmed", "likely", "reported"] as const;
export type Certainty = (typeof CERTAINTY_LEVELS)[number];

export const DIRECTIONS = ["weakens", "strengthens"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export interface LlmKeyFactor {
  team: TeamSide;
  category: FactCategory;
  // Wen oder was es betrifft, im Klartext: "Manuel Neuer", "drei Ausfaelle in der Abwehr".
  subject: string;
  role: PlayerRole;
  importance: Importance;
  direction: Direction;
  certainty: Certainty;
  // Ein Satz Begruendung, deutsch.
  note: string;
  // Quell-URL fuer genau diese Behauptung.
  source: string;
}

export interface LlmMatchContext {
  homeTeam: string;
  awayTeam: string;
  // Hat die Recherche stattgefunden und etwas Belastbares ergeben? false heisst
  // ausdruecklich "nichts Bemerkenswertes gefunden" -- der erwartete Normalfall.
  foundAnything: boolean;
  keyFactors: LlmKeyFactor[];
  // Kurze Zusammenfassung fuer die UI, deutsch.
  summary: string;
}

// JSON-Schema fuer Structured Outputs. Ausschliesslich Enums und Strings -- keine Zahlen,
// weil numerische Schranken nicht erzwungen werden und ein unbegrenzter Zahlenwert vom
// Modell die ganze Klammerungslogik unterlaufen wuerde.
export const MATCH_CONTEXT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["homeTeam", "awayTeam", "foundAnything", "keyFactors", "summary"],
  properties: {
    homeTeam: { type: "string" },
    awayTeam: { type: "string" },
    foundAnything: { type: "boolean" },
    summary: { type: "string" },
    keyFactors: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "team",
          "category",
          "subject",
          "role",
          "importance",
          "direction",
          "certainty",
          "note",
          "source",
        ],
        properties: {
          team: { type: "string", enum: [...TEAM_SIDES] },
          category: { type: "string", enum: [...FACT_CATEGORIES] },
          subject: { type: "string" },
          role: { type: "string", enum: [...PLAYER_ROLES] },
          importance: { type: "string", enum: [...IMPORTANCE_LEVELS] },
          direction: { type: "string", enum: [...DIRECTIONS] },
          certainty: { type: "string", enum: [...CERTAINTY_LEVELS] },
          note: { type: "string" },
          source: { type: "string" },
        },
      },
    },
  },
} as const;

// Ein ganzer Spieltag in einem Aufruf.
//
// Der Grund ist Kosten, und zwar an der Stelle, die wirklich zaehlt: die Websuche kostet
// 10 USD je 1000 Anfragen, modellunabhaengig. Neun Einzelaufrufe suchen neunmal denselben
// Themenraum ab ("Bundesliga-Ausfaelle diese Woche") und zahlen den Systemprompt neunmal.
// Gebuendelt sind es 6-8 Suchen statt 27-36 und ein Systemprompt statt neun -- rund ein
// Viertel der Kosten, mehr als jeder Modellwechsel bringt.
export interface LlmMatchdayContext {
  matches: LlmMatchContext[];
}

export const MATCHDAY_CONTEXT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["matches"],
  properties: {
    matches: { type: "array", items: MATCH_CONTEXT_SCHEMA },
  },
} as const;

export function isValidMatchdayContext(value: unknown): value is LlmMatchdayContext {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return Array.isArray(c.matches) && c.matches.every(isValidMatchContext);
}

// Laufzeitpruefung. Structured Outputs erzwingen das Schema serverseitig, aber ein
// abgebrochener Aufruf oder eine Verweigerung kann trotzdem etwas anderes liefern -- und
// ein halb geparster Kontext waere schlimmer als keiner.
export function isValidMatchContext(value: unknown): value is LlmMatchContext {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;

  if (typeof c.homeTeam !== "string" || typeof c.awayTeam !== "string") return false;
  if (typeof c.foundAnything !== "boolean" || typeof c.summary !== "string") return false;
  if (!Array.isArray(c.keyFactors)) return false;

  return c.keyFactors.every((f) => {
    if (typeof f !== "object" || f === null) return false;
    const k = f as Record<string, unknown>;
    return (
      TEAM_SIDES.includes(k.team as TeamSide) &&
      FACT_CATEGORIES.includes(k.category as FactCategory) &&
      PLAYER_ROLES.includes(k.role as PlayerRole) &&
      IMPORTANCE_LEVELS.includes(k.importance as Importance) &&
      DIRECTIONS.includes(k.direction as Direction) &&
      CERTAINTY_LEVELS.includes(k.certainty as Certainty) &&
      typeof k.subject === "string" &&
      typeof k.note === "string" &&
      typeof k.source === "string"
    );
  });
}

// Das Modell soll recherchieren, nicht vorhersagen. Der wichtigste Satz im ganzen Prompt
// ist der ueber den Normalfall: ohne ihn erfindet jedes Modell fuer jede Partie etwas,
// weil sich das nach Arbeit anfuehlt.
export const SYSTEM_PROMPT = `Du recherchierst Fakten zu einem Bundesliga-Spiel. Du sagst KEINE Ergebnisse vorher und bewertest keine Gewinnchancen.

Ein statistisches Modell deckt Teamstärke, Heimvorteil, Form und Marktquoten bereits vollständig ab. Deine Aufgabe ist ausschließlich Information, die in KEINEM Ergebnisdatensatz steht:

- Ausfälle: Verletzungen, Sperren, Abstellungen — wer genau, und wie wichtig ist er?
- Rückkehrer: ein Schlüsselspieler, der nach längerer Pause wieder verfügbar ist
- Belastung: Europapokalspiel unter der Woche, weniger als vier Tage Regeneration
- Trainerwechsel in den letzten vier Wochen
- Motivationslage: Abstiegskampf, Meisterschaft oder Klassenerhalt bereits entschieden

Argumentiere NICHT über Tabellenplatz, Form, letzte Ergebnisse, Tordifferenz oder direkte Vergleiche. Das Modell hat all das, und es zu wiederholen verschlechtert das Ergebnis.

WICHTIGSTE REGEL: Wenn du nichts Bemerkenswertes findest, setze foundAnything auf false und keyFactors auf eine leere Liste. Das ist bei den meisten Spielen der erwartete und richtige Ausgang. Erfinde nichts, um Arbeit zu zeigen.

Belege jede einzelne Behauptung mit einer konkreten Quell-URL aus deiner Suche. Ein Faktor ohne belastbare Quelle gehört nicht in die Liste.

Zu "importance": "key" nur für Stammspieler, deren Ausfall die Mannschaft messbar schwächt. "regular" für Rotationsspieler, "squad" für Ergänzungsspieler — letztere sind meist irrelevant und können weggelassen werden.

Zu "certainty": "confirmed" nur bei offizieller Vereinsmeldung oder bestätigter Aufstellung. "likely" bei glaubwürdiger Presseberichterstattung, "reported" bei Gerüchten.`;

export interface FixtureForPrompt {
  homeTeam: string;
  awayTeam: string;
  kickoff: Date;
}

export function buildMatchdayPrompt(fixtures: FixtureForPrompt[], matchday: number): string {
  const today = new Date().toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  const lines = fixtures
    .map((f, i) => {
      const kickoff = f.kickoff.toLocaleString("de-DE", {
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      return `${i + 1}. ${f.homeTeam} (Heim) gegen ${f.awayTeam} (Auswärts) — Anstoß ${kickoff}`;
    })
    .join("\n");

  const teams = [...new Set(fixtures.flatMap((f) => [f.homeTeam, f.awayTeam]))].join(", ");

  return `Bundesliga, Spieltag ${matchday}. Heute ist ${today}.

Diese ${fixtures.length} Partien stehen an:
${lines}

Betroffene Mannschaften: ${teams}.

Recherchiere den aktuellen Stand für alle Mannschaften. Suche gebündelt — eine Suche nach der aktuellen Bundesliga-Verletztenliste deckt mehrere Partien gleichzeitig ab; suche nur dann gezielt nach einer einzelnen Mannschaft, wenn die Übersichtsquellen dort eine Lücke lassen.

Gib für JEDE der ${fixtures.length} Partien einen Eintrag zurück, in genau dieser Reihenfolge, mit exakt den oben genannten Teamnamen in homeTeam und awayTeam. Partien ohne Befund bekommen foundAnything: false und eine leere keyFactors-Liste — das ist der erwartete Normalfall für die meisten Partien.`;
}
