// Punkteschema des Tippspiels.
//
// Das ist die eigentliche Zielgroesse des Projekts -- nicht die Tendenz-Trefferquote.
// Sobald es ein Punkteschema gibt, ist der wahrscheinlichste Einzelspielstand (argmax
// der Score-Matrix) nachweislich der falsche Tipp: richtig ist der Tipp mit dem
// hoechsten Punkte-ERWARTUNGSWERT. Siehe src/model/tipSelector.ts.

export interface ScoringScheme {
  key: string;
  label: string;
  exact: number;
  goalDifference: number;
  tendency: number;
  wrong: number;
}

export const SCORING_SCHEMES: Record<string, ScoringScheme> = {
  kicktipp432: {
    key: "kicktipp432",
    label: "4 / 3 / 2 (Kicktipp-Standard)",
    exact: 4,
    goalDifference: 3,
    tendency: 2,
    wrong: 0,
  },
  kicktipp321: {
    key: "kicktipp321",
    label: "3 / 2 / 1",
    exact: 3,
    goalDifference: 2,
    tendency: 1,
    wrong: 0,
  },
  exactOnly: {
    key: "exactOnly",
    label: "Nur exaktes Ergebnis",
    exact: 1,
    goalDifference: 0,
    tendency: 0,
    wrong: 0,
  },
  // Kein Deko-Preset: unter 1/1/1 muss der EV-Tippselektor exakt dieselbe Tendenz
  // waehlen wie die alte argmax-Logik. Damit ist der Selektor gegen sich selbst
  // testbar, ohne dass wir eine Referenzimplementierung brauchen.
  tendencyOnly: {
    key: "tendencyOnly",
    label: "Nur Tendenz",
    exact: 1,
    goalDifference: 1,
    tendency: 1,
    wrong: 0,
  },
};

export const DEFAULT_SCHEME_KEY = "kicktipp432";

export function resolveScheme(key?: string | null): ScoringScheme {
  if (key && SCORING_SCHEMES[key]) return SCORING_SCHEMES[key];
  return SCORING_SCHEMES[DEFAULT_SCHEME_KEY];
}

function sign(x: number): -1 | 0 | 1 {
  return x > 0 ? 1 : x < 0 ? -1 : 0;
}

export function pointsFor(
  tipHome: number,
  tipAway: number,
  actualHome: number,
  actualAway: number,
  scheme: ScoringScheme
): number {
  if (tipHome === actualHome && tipAway === actualAway) return scheme.exact;

  const tipSign = sign(tipHome - tipAway);
  const actualSign = sign(actualHome - actualAway);
  if (tipSign !== actualSign) return scheme.wrong;

  // Die Unentschieden-Falle, und sie schlaegt still zu:
  // Bei einem Unentschieden-Tipp ist "gleiche Tordifferenz" gleichbedeutend mit "exakt"
  // (beide Differenzen sind 0, also sind beide Ergebnisse identisch) -- und der Fall ist
  // oben schon abgehandelt. Tipp 1:1 auf ein 2:2 gibt deshalb tendency (2), NICHT
  // goalDifference (3). Ohne den `tipSign !== 0`-Guard zahlt diese Funktion jeden
  // Unentschieden-Tipp zu hoch aus, der EV-Selektor lernt daraus, dass Remis-Tipps
  // lohnen, und empfiehlt dann ueberall 1:1.
  if (tipSign !== 0 && tipHome - tipAway === actualHome - actualAway) return scheme.goalDifference;

  return scheme.tendency;
}

// Maximal erreichbare Punktzahl -- fuer Fortschrittsanzeigen und Sanity-Checks.
export function maxPoints(scheme: ScoringScheme): number {
  return Math.max(scheme.exact, scheme.goalDifference, scheme.tendency, scheme.wrong);
}
