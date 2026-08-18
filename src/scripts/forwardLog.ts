// Protokolliert die Vorhersagen eines Spieltags VOR Anpfiff.
//
//   npm run forward-log              -- naechster Spieltag
//   npm run forward-log -- --matchday=3
//
// Einmal pro Spieltag vor Anpfiff laufen lassen, nach `npm run refresh-llm`.
//
// Warum das existiert: alles andere in diesem Projekt ist Backtest. Ein Backtest kann nur
// zeigen, dass eine Aenderung auf VERGANGENEN Daten besser gewesen waere. Ob sie auch
// wirklich eintritt, entscheidet sich prospektiv -- und prospektiv messen kann nur, wer
// die Vorhersage aufschreibt, BEVOR das Ergebnis feststeht.
//
// Fuer den LLM-Kontext ist das nicht bloss sauberer, sondern die einzige Moeglichkeit
// ueberhaupt: historisch laesst er sich nicht ehrlich testen, weil das Modell hinter dem
// LLM den Ausgang alter Spiele kennt. Deshalb stehen hier genau zwei Varianten
// nebeneinander -- mit und ohne Kontext, sonst identisch.
//
// Die Datei ist append-only und wird nie umgeschrieben. Ergebnisse stehen bewusst NICHT
// darin -- forwardEval.ts joint sie zur Auswertungszeit aus den CSVs dazu. Damit gibt es
// keinen Pfad, auf dem eine einmal abgegebene Vorhersage nachtraeglich veraendert werden
// koennte, und genau das macht sie als Evidenz brauchbar.

import { appendFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { loadEnvLocal } from "../data/loadEnv";
import { loadAllMatches } from "../data/loadMatches";
import { buildLeagueModel } from "../model/teamStrength";
import { predictPipeline } from "../model/predictPipeline";
import { computeXgForm } from "../model/xgForm";
import { argmaxCell } from "../model/scoreMatrix";
import { DEFAULT_PIPELINE, configHash } from "../model/pipelineConfig";
import { FORWARD_SEASON } from "../eval/splits";
import { cacheKey, readLlmCache } from "../llm/llmCache";

loadEnvLocal();

const DATA_DIR = join(process.cwd(), "data");
const LOG_PATH = join(DATA_DIR, "forward_log.jsonl");

interface Fixture {
  homeTeam: string;
  awayTeam: string;
  date: string;
  matchday: number;
}

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

const allFixtures: Fixture[] = JSON.parse(readFileSync(join(DATA_DIR, "fixtures.json"), "utf-8"));
const hash = configHash(DEFAULT_PIPELINE);

const now = new Date();
const upcoming = allFixtures.filter((f) => new Date(f.date) >= now);
const nextMatchday = upcoming.length > 0 ? Math.min(...upcoming.map((f) => f.matchday)) : null;
const matchday = flag("matchday") ? Number(flag("matchday")) : nextMatchday;

if (matchday == null) {
  console.error("Kein kommender Spieltag gefunden. Nichts zu protokollieren.");
  process.exit(0);
}

const fixtures = allFixtures.filter((f) => f.matchday === matchday);
if (fixtures.length === 0) {
  console.error(`Spieltag ${matchday} enthaelt keine Spiele.`);
  process.exit(1);
}

// Idempotent: bereits protokollierte Spiele derselben Konfiguration werden uebersprungen.
// Ein zweiter Aufruf am selben Tag darf keine Duplikate erzeugen, sonst waeren die
// gepaarten Tests spaeter verzerrt.
const alreadyLogged = new Set<string>();
if (existsSync(LOG_PATH)) {
  for (const line of readFileSync(LOG_PATH, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      alreadyLogged.add(
        `${entry.season}|${entry.matchday}|${entry.configHash}|${entry.homeTeam}|${entry.awayTeam}`
      );
    } catch {
      // Kaputte Zeile ueberspringen statt abbrechen -- ein append-only-Log darf nicht an
      // einer einzelnen unlesbaren Zeile scheitern.
    }
  }
}

const llmCache = readLlmCache();
const llmMatchesMatchday = llmCache !== null && llmCache.matchday === matchday;
const llmByFixture = llmMatchesMatchday ? llmCache!.contexts : {};

if (!llmMatchesMatchday) {
  console.warn(
    `Hinweis: kein Spielkontext fuer Spieltag ${matchday} im Cache. Die withLlm-Variante\n` +
      `         faellt dann mit der Basisvariante zusammen und traegt nichts zum gepaarten\n` +
      `         Vergleich bei. Vorher "npm run refresh-llm" laufen lassen.\n`
  );
}

const model = buildLeagueModel(loadAllMatches());

let written = 0;
let skipped = 0;
let withContext = 0;

// Die Zahlen, an denen sich die Vorhersage spaeter messen lassen muss. Bewusst nicht die
// ganze Matrix -- das Log soll lesbar bleiben -- aber genug, um jede der vier bewerteten
// Maerkte zu rekonstruieren.
function variantOf(out: ReturnType<typeof predictPipeline>) {
  const p = out.prices;
  return {
    probs: out.probs,
    expectedGoals: [out.expectedHomeGoals, out.expectedAwayGoals],
    over25: p.totals.find((t) => t.line === 2.5)?.over.prob ?? null,
    bttsYes: p.bothTeamsToScore.yes.prob,
    handicaps: p.handicaps.map((h) => ({ line: h.line, homeProb: h.home.prob })),
    topScores: p.correctScore.slice(0, 10).map((c) => ({ score: c.score, prob: c.price.prob })),
    mostLikelyScore: argmaxCell(out.matrix),
  };
}

for (const fixture of fixtures) {
  const key = `${FORWARD_SEASON}|${matchday}|${hash}|${fixture.homeTeam}|${fixture.awayTeam}`;
  if (alreadyLogged.has(key)) {
    skipped++;
    continue;
  }

  const kickoff = new Date(fixture.date);
  if (kickoff < now) {
    console.warn(`  uebersprungen (bereits angepfiffen): ${fixture.homeTeam} vs ${fixture.awayTeam}`);
    skipped++;
    continue;
  }

  const homeForm = computeXgForm(fixture.homeTeam, kickoff);
  const awayForm = computeXgForm(fixture.awayTeam, kickoff);
  const shared = {
    model,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    homeForm,
    awayForm,
  };

  const cachedLlm = llmByFixture[cacheKey(fixture.homeTeam, fixture.awayTeam)];
  if (cachedLlm) withContext++;

  const base = predictPipeline(shared);
  // Beide Varianten werden IMMER geloggt, auch wenn der Kontext leer ist -- genau die
  // Nullzeilen machen den gepaarten Test gueltig.
  const withLlm = predictPipeline({ ...shared, llmContext: cachedLlm?.context ?? null });

  const entry = {
    loggedAt: new Date().toISOString(),
    season: FORWARD_SEASON,
    matchday,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    kickoff: fixture.date,
    configHash: hash,
    form: { home: homeForm, away: awayForm },
    llm: cachedLlm
      ? {
          model: cachedLlm.model,
          fetchedAt: cachedLlm.fetchedAt,
          foundAnything: cachedLlm.context.foundAnything,
          keyFactors: cachedLlm.context.keyFactors,
          summary: cachedLlm.context.summary,
          sources: cachedLlm.sources,
          homeLogAdj: withLlm.llmAdjustment?.homeLogAdj ?? 0,
          awayLogAdj: withLlm.llmAdjustment?.awayLogAdj ?? 0,
          shrinkFactor: withLlm.llmAdjustment?.shrinkFactor ?? 1,
          blocked: withLlm.llmAdjustment?.blocked ?? false,
        }
      : null,
    variants: {
      model: variantOf(base),
      withLlm: variantOf(withLlm),
    },
  };

  appendFileSync(LOG_PATH, `${JSON.stringify(entry)}\n`);
  written++;

  console.log(
    `  ${fixture.homeTeam} vs ${fixture.awayTeam}: ` +
      `${(base.probs.homeWinProb * 100).toFixed(0)}/${(base.probs.drawProb * 100).toFixed(0)}/` +
      `${(base.probs.awayWinProb * 100).toFixed(0)}  ` +
      `wahrscheinlichstes Ergebnis ${argmaxCell(base.matrix)}`
  );
}

console.log(
  `\nSpieltag ${matchday}: ${written} protokolliert, ${skipped} uebersprungen ` +
    `(bereits im Log oder angepfiffen), ${withContext} mit Spielkontext.`
);
console.log(`Konfiguration ${hash}. Log: data/forward_log.jsonl`);
