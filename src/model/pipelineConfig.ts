// Alle Stellschrauben der Vorhersage an einem Ort, plus ein Hash darueber.
//
// Der Hash ist nicht Deko: das Vorwaerts-Log (data/forward_log.jsonl) schreibt ihn in
// jede Zeile. Aendert sich die Pipeline mitten in der Saison, wuerde ein spaeterer
// gepaarter Vergleich sonst still zwei verschiedene Populationen vermischen und ein
// Ergebnis liefern, das nichts bedeutet. forwardEval.ts gruppiert deshalb nach configHash
// und weigert sich, ohne ausdrueckliches --pool darueber hinweg zu mitteln.
//
// Die frueheren Marktfelder (oddsBlendAlpha, useTotals, useSpread, marketStrength) sind
// entfallen. Damit aendert sich der Hash gegenueber allen bisher geloggten Zeilen -- das
// ist beabsichtigt und korrekt: es IST eine andere Pipeline, und die alten Zeilen duerfen
// nicht mit den neuen in einen Topf.

import { DEFAULT_LLM_GAIN, DEFAULT_LLM_MAX_LOG_ADJUSTMENT } from "../llm/llmAdjustment";
import { aggregateFactors, toLambdaExponents } from "../llm/factMapping";
import {
  CERTAINTY_LEVELS,
  DIRECTIONS,
  EXTRACTION_SYSTEM_PROMPT,
  FACT_CATEGORIES,
  IMPORTANCE_LEVELS,
  PLAYER_ROLES,
  RESEARCH_SYSTEM_PROMPT,
  TEAM_SIDES,
  buildExtractionPrompt,
  buildResearchPrompt,
  type LlmKeyFactor,
} from "../llm/matchContext";
import { resolveModelProfile } from "../llm/modelProfile";
import {
  DEFAULT_DRAW_BOOST,
  DEFAULT_MAX_GOALS,
  DEFAULT_OUTCOME_TEMPERATURE,
  DEFAULT_RHO,
} from "./scoreMatrix";
import { SEASON_RECENCY_WEIGHTS } from "./teamStrength";
import { XG_FORM_WEIGHT, XG_FORM_WINDOW } from "./xgForm";

export interface PipelineConfig {
  // Fit
  ridgePseudoMatches: number;
  seasonRecencyWeights: number[];
  // Form
  xgFormWindow: number;
  xgFormWeight: number;
  // Matrix
  maxGoals: number;
  rho: number;
  drawBoost: number;
  // Kalibrierungstemperatur auf den 1X2-Massen, auf Validation gefittet.
  outcomeTemperature: number;
  // LLM-Layer. Gehoert hierher, obwohl er nicht unter src/model/ liegt: er veraendert die
  // Torerwartung und damit jede Zahl der Vorhersage. Standen diese beiden Werte nicht im
  // Hash, blieb er beim Drehen des Gains unveraendert -- und das Vorwaerts-Log haette
  // stillschweigend zwei Populationen unter derselben Kennung gesammelt. Genau der Fehler,
  // gegen den der Hash gebaut wurde.
  //
  // Gilt fuer die Voreinstellungen. Wer predictPipeline eigene llmOptions uebergibt, hat
  // eine andere Pipeline als der Hash behauptet -- forwardLog.ts tut das bewusst nicht.
  llmGain: number;
  llmMaxLogAdjustment: number;
  // Fingerabdruck der Rechercheanweisung und Name des Sprachmodells. Eine geaenderte
  // Anweisung oder ein anderes Modell liefern andere Fakten und damit eine andere Pipeline
  // -- auch wenn keine einzige Zahl angefasst wurde.
  llmPromptFingerprint: string;
  llmMappingFingerprint: string;
  llmModel: string;
}

// Der Fingerabdruck deckt beide Haelften der Anweisung ab: den Systemprompt und die
// Nutzeranweisung. Letztere ist eine Vorlage mit wechselndem Inhalt (Datum, Spieltag,
// Paarungen) -- wuerde man sie roh hashen, aenderte sich der Fingerabdruck jede Woche und
// zerlegte das Vorwaerts-Log in 34 Populationen. Deshalb wird sie mit festen Platzhaltern
// gerendert und danach jede Ziffer maskiert: uebrig bleibt genau der Wortlaut, und der
// aendert sich nur, wenn jemand die Anweisung wirklich umschreibt.
//
// Exportiert, damit selfCheck.ts nachweisen kann, dass keine Ziffer durchkommt. Bliebe
// eine stehen, waere es das Tagesdatum, und der Fingerabdruck waere ueber Nacht ein
// anderer.
// Seit dem Umbau auf zwei Stufen (2026-09-01) deckt der Abdruck BEIDE Nutzeranweisungen
// ab. Die Extraktionsanweisung enthaelt den Recherchebericht -- der wechselt natuerlich
// jede Woche, deshalb steht an seiner Stelle ein fester Platzhalter. Gehashst wird der
// Wortlaut der Anweisung, nicht ihr Inhalt.
export function canonicalUserPrompt(): string {
  const kickoff = new Date(Date.UTC(2000, 0, 1, 12, 0));
  const fixtures = [
    { homeTeam: "Heimteam", awayTeam: "Auswaertsteam", kickoff },
    { homeTeam: "Heimteam Zwei", awayTeam: "Auswaertsteam Zwei", kickoff },
  ];
  return [
    buildResearchPrompt(fixtures, 1),
    buildExtractionPrompt(fixtures, "BERICHT"),
  ]
    .join("\n")
    .replace(/\d/g, "#");
}

// Trennzeichen zwischen den beiden Haelften. Sichtbar und benannt, weil hier zwischen-
// zeitlich ein echtes NUL-Byte stand: die Datei galt git dadurch als binaer, jeder Diff
// war unlesbar, und ein Steuerzeichen im Quelltext ueberlebt weder Editor noch Copy-Paste
// zuverlaessig -- es haette den Abdruck und damit den Konfigurations-Hash still
// verschieben koennen.
const PROMPT_PART_SEPARATOR = "\n--- Nutzeranweisung ---\n";

export function llmPromptFingerprint(): string {
  const systems = `${RESEARCH_SYSTEM_PROMPT}${PROMPT_PART_SEPARATOR}${EXTRACTION_SYSTEM_PROMPT}`;
  return fnv1a(`${systems}${PROMPT_PART_SEPARATOR}${canonicalUserPrompt()}`);
}

// Zweiter Fingerabdruck, und der subtilere: die Uebersetzung recherchierter Fakten in
// Torerwartung. ROLE_WEIGHTS, IMPORTANCE_SCALE, die Sicherheitsstufen, die Daempfung ab dem
// zweiten Fakt -- ein Dutzend Zahlen in factMapping.ts, die die Korrektur genauso
// veraendern wie der Gain. Sie einzeln aufzuzaehlen waere die Variante, die beim naechsten
// hinzugefuegten Gewicht still auseinanderfaellt.
//
// Deshalb kein Abbild der Konstanten, sondern des VERHALTENS: die Zuordnung wird ueber jede
// Kombination aus Position, Wichtigkeit, Sicherheit, Richtung und Seite gerechnet, und die
// herauskommenden Exponenten werden gehasht. Damit faellt jede Aenderung auf -- an einem
// Gewicht, an einer Formel, an der Aggregation -- ohne dass jemand daran denken muss.
export function llmMappingFingerprint(): string {
  const samples: string[] = [];
  for (const role of PLAYER_ROLES) {
    for (const importance of IMPORTANCE_LEVELS) {
      for (const certainty of CERTAINTY_LEVELS) {
        for (const direction of DIRECTIONS) {
          for (const team of TEAM_SIDES) {
            const factor: LlmKeyFactor = {
              team,
              category: FACT_CATEGORIES[0],
              subject: "X",
              role,
              importance,
              direction,
              certainty,
              note: "",
              source: "",
            };
            // Zwei gleiche Fakten statt einem, damit auch die Rangdaempfung mitlaeuft --
            // die greift erst ab dem zweiten.
            const exponents = toLambdaExponents(aggregateFactors([factor, factor]));
            samples.push(`${exponents.home.toFixed(9)}|${exponents.away.toFixed(9)}`);
          }
        }
      }
    }
  }
  return fnv1a(samples.join(","));
}

// Exakt die aktuell produktiven Werte.
export const DEFAULT_PIPELINE: PipelineConfig = {
  ridgePseudoMatches: 0,
  seasonRecencyWeights: SEASON_RECENCY_WEIGHTS,
  xgFormWindow: XG_FORM_WINDOW,
  xgFormWeight: XG_FORM_WEIGHT,
  maxGoals: DEFAULT_MAX_GOALS,
  rho: DEFAULT_RHO,
  drawBoost: DEFAULT_DRAW_BOOST,
  outcomeTemperature: DEFAULT_OUTCOME_TEMPERATURE,
  llmGain: DEFAULT_LLM_GAIN,
  llmMaxLogAdjustment: DEFAULT_LLM_MAX_LOG_ADJUSTMENT,
  llmPromptFingerprint: llmPromptFingerprint(),
  llmMappingFingerprint: llmMappingFingerprint(),
  // Aus der Umgebung aufgeloest (LLM_MODEL), sonst die Voreinstellung. ACHTUNG: das ist der
  // Wert zum Zeitpunkt des Logschreibens, nicht zwingend der, mit dem der Spielkontext
  // tatsaechlich geholt wurde. forwardLog.ts setzt deshalb das Modell aus dem Cache ein --
  // sonst behauptet der Hash ein Modell, das gar nicht gelaufen ist.
  llmModel: resolveModelProfile().model,
};

// FNV-1a, 32 Bit. Kurz genug zum Lesen im Log, kollisionsfrei genug fuer eine Handvoll
// Konfigurationen pro Saison.
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function configHash(config: PipelineConfig = DEFAULT_PIPELINE): string {
  return fnv1a(
    JSON.stringify([
      config.ridgePseudoMatches,
      config.seasonRecencyWeights,
      config.xgFormWindow,
      config.xgFormWeight,
      config.maxGoals,
      config.rho,
      config.drawBoost,
      config.outcomeTemperature,
      config.llmGain,
      config.llmMaxLogAdjustment,
      config.llmPromptFingerprint,
      config.llmMappingFingerprint,
      config.llmModel,
    ])
  );
}
