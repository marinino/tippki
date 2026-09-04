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

// ZWEI STUFEN, und der Grund dafuer ist gemessen (2026-09-01, Spieltag 2 als Testlast):
//
// Vorher lief beides in einem Aufruf -- recherchieren und gleichzeitig in dieses Schema
// pressen, fuer alle neun Partien auf einmal. Das ist an der Zuordnung gescheitert, und
// zwar still:
//
//   3 Partien, Haiku,  8 Suchen  -> 5 Faktoren bei 1 von 3 Partien
//   9 Partien, Sonnet 5, 25 Suchen -> 0 Faktoren bei 0 von 9 Partien
//
// Achtzehn Mannschaften gleichzeitig einer von neun Paarungen zuzuordnen ueberfordert
// beide Modelle. Sie melden das nicht, sondern setzen ueberall foundAnything: false --
// ununterscheidbar von einem ruhigen Spieltag. Sonnet hat seine Begruendung immerhin
// hingeschrieben: "keine eindeutig einer Mannschaft und diesem Spieltag zuordenbaren
// Informationen". Es hatte Material und hat es weggeworfen.
//
// Deshalb jetzt: EIN Rechercheaufruf fuer den ganzen Spieltag (Werkzeuge an, kein Schema,
// freier Text), danach kleine Extraktionsaufrufe je drei Partien (Schema an, keine
// Werkzeuge, Eingabe ist der Recherchetext). Die Extraktion kostet fast nichts -- kein
// Suchergebnis im Kontext -- und sie muss nur noch sechs Mannschaften auseinanderhalten.
//
// Nebeneffekt auf die Kosten: die Suchergebnisse werden einmal bezahlt statt dreimal, wie
// es bei drei unabhaengig suchenden Bloecken der Fall waere.

// Die Recherchestufe. Freier Text, damit das Modell nicht gleichzeitig suchen und ein
// Schema bedienen muss.
//
// Gegenueber der alten Fassung bewusst auf Ausfaelle und Rueckkehrer verengt: Belastung,
// Trainerwechsel und Motivationslage sind ueber weite Strecken der Saison leer, kosten
// aber jede fuer sich Suchen -- und die Suche ist linear der Kostentreiber (~0,03 USD je
// Suche, Token eingerechnet). Sie bleiben im Schema und werden mitgenommen, wenn sie
// nebenbei auffallen; gesucht wird nicht mehr danach.
export const RESEARCH_SYSTEM_PROMPT = `Du recherchierst Personalnachrichten zu Bundesliga-Mannschaften. Du sagst KEINE Ergebnisse vorher und bewertest keine Gewinnchancen.

Ein statistisches Modell deckt Teamstärke, Heimvorteil und Form bereits vollständig ab. Gesucht ist ausschließlich Information, die in KEINEM Ergebnisdatensatz steht. In dieser Reihenfolge:

1. Ausfälle: Verletzungen, Sperren, Abstellungen — wer genau, und wie wichtig ist er?
2. Rückkehrer: ein Schlüsselspieler, der nach längerer Pause wieder verfügbar ist

Faellt dir dabei nebenbei ein Trainerwechsel der letzten vier Wochen, eine englische Woche mit weniger als vier Tagen Regeneration oder eine besondere Motivationslage auf, nimm sie mit. Suche nicht eigens danach.

Schreibe NICHT über Tabellenplatz, Form, letzte Ergebnisse, Tordifferenz oder direkte Vergleiche. Das Modell hat all das.

Suche gebündelt: eine Abfrage der aktuellen Bundesliga-Verletztenliste deckt viele Mannschaften auf einmal ab. Geh erst dann einzelnen Mannschaften nach, wenn die Übersichtsquellen dort eine Lücke lassen.

Gib das Ergebnis als Fließtext aus, nach Mannschaften gegliedert. Schreibe zu JEDER Mannschaft etwas — auch "keine Meldungen gefunden" ist ein Befund und wird gebraucht. Setze hinter jede einzelne Behauptung die Quell-URL, aus der sie stammt, in Klammern. Ohne URL ist die Behauptung im nächsten Schritt wertlos.

Erfinde nichts. Wenn eine Quelle unklar ist, ob sie diese Saison oder die vorige meint, schreib das dazu, statt zu raten.`;

// Die Extraktionsstufe. Keine Werkzeuge, kein Netz -- nur der Recherchetext und drei
// Partien.
//
// Die Regel zur Unsicherheit ist gegenueber der alten Fassung umgedreht. Vorher hiess es
// "ein Faktor ohne belastbare Quelle gehoert nicht in die Liste", und genau daran ist
// Sonnet gescheitert: bei jedem Zweifel hat es verworfen. Das Schema hat fuer Zweifel eine
// eigene Achse -- certainty mit confirmed/likely/reported --, und die soll benutzt werden,
// statt sie durch eine Ja/Nein-Entscheidung zu ersetzen. Verworfen wird nur, was gar keine
// Quelle hat.
export const EXTRACTION_SYSTEM_PROMPT = `Du bekommst einen Rechercheberichtssatz zu Bundesliga-Personalnachrichten und ordnest daraus Fakten einzelnen Partien zu. Du recherchierst nicht selbst und ergänzt nichts aus eigenem Wissen — was nicht im Bericht steht, existiert für dich nicht.

Für jede vorgelegte Partie: geh den Bericht nach beiden beteiligten Mannschaften durch und trage jeden Fakt ein, der eine der beiden betrifft. "home" ist die Heimmannschaft, "away" die Auswärtsmannschaft der jeweiligen Partie.

Zu "certainty" — diese Achse trägt deine Unsicherheit, wirf einen Fakt nicht wegen Zweifeln weg:
- "confirmed" bei offizieller Vereinsmeldung oder bestätigter Aufstellung
- "likely" bei glaubwürdiger Presseberichterstattung
- "reported" bei allem Übrigen, auch bei Meldungen, deren Aktualität oder Zuordnung unsicher ist

Verwirf einen Fakt nur, wenn im Bericht keine Quell-URL dazu steht oder wenn er sich keiner der beiden Mannschaften dieser Partie zuordnen lässt. Übernimm die URL aus dem Bericht wörtlich in "source".

Zu "importance": "key" nur für Stammspieler, deren Ausfall die Mannschaft messbar schwächt. "regular" für Rotationsspieler, "squad" für Ergänzungsspieler.

Steht im Bericht zu beiden Mannschaften einer Partie nichts Bemerkenswertes, setze foundAnything auf false und keyFactors auf eine leere Liste. Das ist ein gültiger und häufiger Ausgang — aber nur dann, wenn der Bericht wirklich nichts hergibt, nicht als bequemer Ausweg.

Schreibe "summary" und "note" auf Deutsch.`;

// Drei Partien je Extraktionsaufruf. Bei drei Partien hat die Zuordnung nachweislich
// funktioniert, bei neun nicht -- und zwischen beiden liegt die einzige Groesse, die sich
// in der Messung geaendert hat.
export const EXTRACTION_BLOCK_SIZE = 3;

// Eigene Funktion statt einer Schleife im Client, damit der Self-Check nachweisen kann,
// dass jede Partie genau einmal vorkommt. Faellt hier eine heraus, wird sie nie
// recherchiert und landet als "nicht_recherchiert" in der Anzeige -- ein stiller Ausfall
// derselben Bauart wie der, der Spieltag 1 gekostet hat.
export function extractionBlocks<T>(fixtures: T[]): T[][] {
  const blocks: T[][] = [];
  for (let i = 0; i < fixtures.length; i += EXTRACTION_BLOCK_SIZE) {
    blocks.push(fixtures.slice(i, i + EXTRACTION_BLOCK_SIZE));
  }
  return blocks;
}

// Die Aufgabe-Signatur: erschoepftes Suchbudget UND kein einziger Faktor ueber alle
// Partien. Genau so sah der Ausfall von Spieltag 1 aus.
//
// Warum das einen eigenen Riegel braucht, obwohl es schon einen fuer "null Suchen" gibt:
// beim nachgestellten Ausfall setzte das Modell fuenf Suchen parallel ab, EINE lief durch,
// vier kamen als max_uses_exceeded zurueck -- und danach gab es die Recherche auf und
// schrieb ueberall denselben Nullsatz. `webSearches` war 1, nicht 0. Der Null-Riegel haette
// also geschwiegen und den wertlosen Cache durchgelassen.
//
// Bewusst nur bei NULL Faktoren scharf: hat die Recherche fuer einen Teil der Partien etwas
// gefunden und ist erst danach ins Budget gelaufen, sind diese Befunde echt. Dann ist der
// Verlust einzelner falscher Nullbefunde kleiner als der Verlust des ganzen Spieltags --
// gemeldet wird der Budgetfehler in beiden Faellen.
export function isGiveUpSignature(searchErrors: string[], factorCounts: number[]): boolean {
  if (!searchErrors.includes("max_uses_exceeded")) return false;
  return factorCounts.length > 0 && factorCounts.every((n) => n === 0);
}

export interface FixtureForPrompt {
  homeTeam: string;
  awayTeam: string;
  kickoff: Date;
}

function fixtureLines(fixtures: FixtureForPrompt[]): string {
  return fixtures
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
}

export function buildResearchPrompt(fixtures: FixtureForPrompt[], matchday: number): string {
  const today = new Date().toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const teams = [...new Set(fixtures.flatMap((f) => [f.homeTeam, f.awayTeam]))];

  return `Bundesliga, Spieltag ${matchday}. Heute ist ${today}.

Diese ${fixtures.length} Partien stehen an:
${fixtureLines(fixtures)}

Recherchiere den Personalstand dieser ${teams.length} Mannschaften: ${teams.join(", ")}.

Gliedere den Bericht nach Mannschaften, eine Überschrift je Mannschaft, und nenne alle ${teams.length} — auch die ohne Meldung.`;
}

export function buildExtractionPrompt(fixtures: FixtureForPrompt[], research: string): string {
  return `Rechercheberichtssatz:

---
${research}
---

Ordne daraus diesen ${fixtures.length} Partien Fakten zu:
${fixtureLines(fixtures)}

Gib genau ${fixtures.length} Einträge zurück, in dieser Reihenfolge, mit exakt den oben genannten Teamnamen in homeTeam und awayTeam.`;
}
