// Train/Validation/Test-Trennung.
//
// Bisher lief jede Auswertung ueber dieselben acht Saisons 2018-2025, und auf genau
// diesen acht Saisons wurden auch alle Hyperparameter gewaehlt (ODDS_BLEND_ALPHA per
// 11-Werte-Scan, XG_FORM_WINDOW, RHO, DRAW_BOOST). Damit ist die berichtete Zahl kein
// Out-of-Sample-Ergebnis mehr, sondern das Maximum ueber alles, was ausprobiert wurde --
// und systematisch zu optimistisch.
//
// Ab jetzt: getunt wird ausschliesslich auf VALIDATION_SEASONS. TEST_SEASONS werden
// genau einmal am Ende angefasst, mit einer eingefrorenen Konfiguration.

export const VALIDATION_SEASONS = ["2018", "2019", "2020", "2021", "2022"];
export const TEST_SEASONS = ["2023", "2024", "2025"];
export const ALL_EVAL_SEASONS = [...VALIDATION_SEASONS, ...TEST_SEASONS];

// Die laufende Saison 2026/27. Echtes Holdout -- hier wird der LLM-Layer vorwaerts
// getestet, weil er sich historisch nicht ehrlich messen laesst (das Modell kennt den
// Ausgang vergangener Spiele).
export const FORWARD_SEASON = "2026";

export type SplitName = "validation" | "test" | "all";

export function seasonsFor(split: SplitName): string[] {
  if (split === "validation") return VALIDATION_SEASONS;
  if (split === "test") return TEST_SEASONS;
  return ALL_EVAL_SEASONS;
}

export function parseSplit(raw?: string | null): SplitName {
  if (raw === "validation" || raw === "test" || raw === "all") return raw;
  return "validation";
}

// Standardfehler der Trefferquote bei gegebenem n -- damit jede Ausgabe daneben zeigen
// kann, ob der berichtete Unterschied ueberhaupt aufloesbar ist.
export function accuracyStandardError(n: number, p = 0.525): number {
  if (n <= 0) return 0;
  return Math.sqrt((p * (1 - p)) / n);
}

const TEST_BANNER = [
  "",
  "  ############################################################################",
  "  #  TESTSET. Diese Saisons dienen der BESTAETIGUNG, nicht der Entdeckung.   #",
  "  #  Keine Hyperparameter anhand dieser Zahlen waehlen -- sonst ist das      #",
  "  #  Testset verbrannt und es gibt keine ehrliche Out-of-Sample-Zahl mehr.   #",
  "  ############################################################################",
  "",
].join("\n");

export function warnIfTestSplit(split: SplitName): void {
  if (split === "test") console.log(TEST_BANNER);
}
