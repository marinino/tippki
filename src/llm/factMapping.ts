// Uebersetzt recherchierte Fakten in eine Korrektur der Torerwartungen.
//
// Diese Tabelle ist der tunebare Teil des LLM-Layers. Das LLM liefert Fakten, dieser Code
// bestimmt, was sie wert sind -- und das laesst sich spaeter anhand des Vorwaerts-Logs
// nachjustieren, ohne einen einzigen API-Aufruf zu wiederholen.
//
// Die Werte unten sind PRIORS, keine Messungen. Sie stammen aus der Groessenordnung, die
// in der Literatur fuer Ausfaelle von Schluesselspielern berichtet wird (einstellige bis
// niedrige zweistellige Prozentwerte auf die Torrate), nicht aus einer Schaetzung auf
// diesen Daten -- die ist erst moeglich, wenn genug Spieltage protokolliert sind.
//
// Vorzeichenkonvention, passend zum Modell (lambda_heim = avg * exp(att_heim) * exp(def_ausw)):
//   attack  negativ  = Mannschaft trifft weniger
//   defense positiv  = Mannschaft kassiert mehr

import type { Certainty, Importance, LlmKeyFactor, PlayerRole } from "./matchContext";

export interface LambdaDelta {
  // Log-Skala, additiv.
  homeAttack: number;
  homeDefense: number;
  awayAttack: number;
  awayDefense: number;
}

export function emptyDelta(): LambdaDelta {
  return { homeAttack: 0, homeDefense: 0, awayAttack: 0, awayDefense: 0 };
}

// Grundgewicht eines Ausfalls, nach Position. Ein fehlender Torhueter wirkt fast
// ausschliesslich defensiv, ein Stuermer fast ausschliesslich offensiv, Mittelfeld
// gemischt. Die Summe je Position ist bewusst kleiner als man intuitiv erwartet: eine
// Bundesligamannschaft hat einen Kader, und der Ersatzmann ist selten katastrophal.
const ROLE_WEIGHTS: Record<PlayerRole, { attack: number; defense: number }> = {
  goalkeeper: { attack: 0.0, defense: 0.1 },
  defender: { attack: 0.01, defense: 0.07 },
  midfielder: { attack: 0.05, defense: 0.03 },
  forward: { attack: 0.1, defense: 0.0 },
  // Trainerwechsel: Richtung unklar, Streuung steigt -- deshalb klein und symmetrisch.
  coach: { attack: 0.03, defense: 0.03 },
  // Mannschaftsweite Effekte (Belastung, Motivation).
  team: { attack: 0.04, defense: 0.04 },
};

// Wie stark der Kader den Ausfall auffaengt.
const IMPORTANCE_SCALE: Record<Importance, number> = {
  key: 1.0,
  regular: 0.4,
  squad: 0.1,
};

// Wie sicher die Information ist. Ein Geruecht darf nicht wie eine Vereinsmeldung wirken.
const CERTAINTY_SCALE: Record<Certainty, number> = {
  confirmed: 1.0,
  likely: 0.6,
  reported: 0.25,
};

// Kategoriespezifische Daempfung. Belastung und Motivation sind reale, aber schwache und
// schlecht messbare Effekte -- und der Markt preist sie mit Sicherheit schon ein.
const CATEGORY_SCALE: Record<LlmKeyFactor["category"], number> = {
  absence: 1.0,
  return: 0.7,
  congestion: 0.5,
  manager: 0.5,
  motivation: 0.4,
};

// Mehr als drei Faktoren je Mannschaft und Richtung addieren sich sonst zu absurden
// Werten -- vier fehlende Innenverteidiger machen die Abwehr nicht viermal schlechter.
// Deshalb abnehmender Grenzertrag: der n-te Faktor zaehlt nur noch 1/n.
const DIMINISHING_RETURNS = true;

export function factorToDelta(factor: LlmKeyFactor, rank = 0): LambdaDelta {
  const role = ROLE_WEIGHTS[factor.role];
  const scale =
    IMPORTANCE_SCALE[factor.importance] *
    CERTAINTY_SCALE[factor.certainty] *
    CATEGORY_SCALE[factor.category] *
    (DIMINISHING_RETURNS ? 1 / (rank + 1) : 1);

  // "strengthens" (Rueckkehrer) dreht das Vorzeichen: mehr Angriff, weniger Gegentore.
  const sign = factor.direction === "weakens" ? 1 : -1;

  const attackDelta = -sign * role.attack * scale;
  const defenseDelta = sign * role.defense * scale;

  const delta = emptyDelta();
  if (factor.team === "home") {
    delta.homeAttack = attackDelta;
    delta.homeDefense = defenseDelta;
  } else {
    delta.awayAttack = attackDelta;
    delta.awayDefense = defenseDelta;
  }
  return delta;
}

export interface AggregatedDelta extends LambdaDelta {
  // Nachvollziehbarkeit: welcher Faktor hat wie viel beigetragen.
  contributions: { factor: LlmKeyFactor; delta: LambdaDelta }[];
}

// Faktoren werden je (Mannschaft, Richtung) nach Gewicht sortiert, damit der abnehmende
// Grenzertrag den wichtigsten Faktor voll zaehlt und nicht den erstgenannten.
export function aggregateFactors(factors: LlmKeyFactor[]): AggregatedDelta {
  const total = emptyDelta();
  const contributions: AggregatedDelta["contributions"] = [];

  const groups = new Map<string, LlmKeyFactor[]>();
  for (const factor of factors) {
    const key = `${factor.team}|${factor.direction}`;
    const list = groups.get(key);
    if (list) list.push(factor);
    else groups.set(key, [factor]);
  }

  for (const group of groups.values()) {
    const sorted = [...group].sort(
      (a, b) => magnitudeOf(factorToDelta(b)) - magnitudeOf(factorToDelta(a))
    );
    sorted.forEach((factor, rank) => {
      const delta = factorToDelta(factor, rank);
      total.homeAttack += delta.homeAttack;
      total.homeDefense += delta.homeDefense;
      total.awayAttack += delta.awayAttack;
      total.awayDefense += delta.awayDefense;
      contributions.push({ factor, delta });
    });
  }

  return { ...total, contributions };
}

function magnitudeOf(d: LambdaDelta): number {
  return (
    Math.abs(d.homeAttack) + Math.abs(d.homeDefense) + Math.abs(d.awayAttack) + Math.abs(d.awayDefense)
  );
}

// Zusammenfassung zu den beiden Exponenten, die die Pipeline braucht.
//
// lambda_heim haengt am Angriff der Heimmannschaft UND an der Abwehr der Auswaertsmannschaft
// -- letzteres fehlt der bestehenden xG-Formkurve komplett, siehe npm run form.
export function toLambdaExponents(delta: LambdaDelta): { home: number; away: number } {
  return {
    home: delta.homeAttack + delta.awayDefense,
    away: delta.awayAttack + delta.homeDefense,
  };
}
