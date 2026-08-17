// Protokolliert die Vorhersagen eines Spieltags VOR Anpfiff.
//
//   npm run forward-log              -- naechster Spieltag
//   npm run forward-log -- --matchday=3
//
// Einmal pro Spieltag vor Abgabeschluss laufen lassen, nach `npm run refresh-odds`.
//
// Warum das existiert: alles, was bisher gemessen wurde, ist Backtest. Ein Backtest kann
// nur zeigen, dass eine Aenderung auf VERGANGENEN Daten besser gewesen waere. Ob die
// +111 Punkte pro Saison auch wirklich eintreten, entscheidet sich prospektiv -- und
// prospektiv messen kann nur, wer die Vorhersage aufschreibt, BEVOR das Ergebnis
// feststeht. Ohne dieses Log ist die Saison als Evidenz verloren.
//
// Ausserdem ist es die Voraussetzung fuer den geplanten LLM-Kontext-Layer: der laesst
// sich grundsaetzlich nicht historisch backtesten (das Modell kennt den Ausgang alter
// Spiele), sondern nur vorwaerts. Sobald es ihn gibt, kommt eine weitere Variante dazu.
//
// Die Datei ist append-only und wird nie umgeschrieben. Ergebnisse stehen bewusst NICHT
// darin -- forwardEval.ts joint sie zur Auswertungszeit aus den CSVs dazu. Damit gibt es
// keinen Pfad, auf dem eine einmal abgegebene Vorhersage nachtraeglich veraendert werden
// koennte, und genau das macht sie als Evidenz brauchbar.

import { appendFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { loadEnvLocal } from "../data/loadEnv";
import { loadAllMatches } from "../data/loadMatches";
import { readOddsCache } from "../data/oddsApi";
import { buildLeagueModel } from "../model/teamStrength";
import { predictPipeline } from "../model/predictPipeline";
import { computeXgForm } from "../model/xgForm";
import { averageMarketProbabilities } from "../model/marketOdds";
import { argmaxCell } from "../model/scoreMatrix";
import { expectedPointsForTip } from "../model/tipSelector";
import { resolveScheme } from "../eval/scoringScheme";
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
const scheme = resolveScheme(flag("scheme"));
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
      alreadyLogged.add(`${entry.season}|${entry.matchday}|${entry.configHash}|${entry.homeTeam}|${entry.awayTeam}`);
    } catch {
      // Kaputte Zeile ueberspringen statt abbrechen -- ein append-only-Log darf nicht an
      // einer einzelnen unlesbaren Zeile scheitern.
    }
  }
}

const oddsCache = readOddsCache();
const oddsMatchesMatchday = oddsCache !== null && oddsCache.matchday === matchday;
const oddsByFixture = oddsMatchesMatchday ? oddsCache!.odds : {};

const llmCache = readLlmCache();
const llmMatchesMatchday = llmCache !== null && llmCache.matchday === matchday;
const llmByFixture = llmMatchesMatchday ? llmCache!.contexts : {};

if (!llmMatchesMatchday) {
  console.warn(
    `Hinweis: kein Spielkontext fuer Spieltag ${matchday} im Cache. Die withLlm-Variante\n` +
      `         faellt dann mit der full-Variante zusammen und traegt nichts zum gepaarten\n` +
      `         Vergleich bei. Vorher "npm run refresh-llm" laufen lassen.\n`
  );
}

if (!oddsMatchesMatchday) {
  console.warn(
    `WARNUNG: Quoten-Cache passt nicht zu Spieltag ${matchday} ` +
      `(Cache: ${oddsCache ? oddsCache.matchday : "keiner"}).\n` +
      `         Erst "npm run refresh-odds" laufen lassen, sonst wird ohne Markt protokolliert.\n`
  );
}

const model = buildLeagueModel(loadAllMatches());

let written = 0;
let skipped = 0;
let withoutOdds = 0;

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

  const fixtureOdds = oddsByFixture[`${fixture.homeTeam}|${fixture.awayTeam}`];
  if (!fixtureOdds) withoutOdds++;

  const homeForm = computeXgForm(fixture.homeTeam, kickoff);
  const awayForm = computeXgForm(fixture.awayTeam, kickoff);
  const market1x2 = fixtureOdds ? averageMarketProbabilities(fixtureOdds.bookmakers) : null;

  const shared = { model, homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam, homeForm, awayForm, scheme };

  // Drei Varianten auf demselben Spiel. Damit laesst sich nach ein paar Spieltagen
  // gepaart pruefen, ob die im Backtest gemessenen Gewinne auch prospektiv eintreten --
  // statt sie einfach zu glauben.
  const marketInputs = {
    market1x2,
    marketTotals: fixtureOdds?.totals ?? null,
    marketSpread: fixtureOdds?.spread ?? null,
  };
  const cachedLlm = llmByFixture[cacheKey(fixture.homeTeam, fixture.awayTeam)];

  const full = predictPipeline({ ...shared, ...marketInputs });
  // Die einzige Variante mit LLM-Kontext. Beide werden IMMER geloggt, auch wenn der
  // Kontext leer ist -- genau die Nullzeilen machen den gepaarten Test gueltig.
  const withLlm = predictPipeline({
    ...shared,
    ...marketInputs,
    llmContext: cachedLlm?.context ?? null,
  });
  const marketOnly1x2 = predictPipeline({ ...shared, market1x2 });
  const modelOnly = predictPipeline({ ...shared, market1x2: null });

  // Der Ausgangszustand vor diesem Umbau: Argmax der ungeblendeten Modellmatrix.
  const legacyTip = argmaxCell(modelOnly.matrix);
  const [legacyHome, legacyAway] = legacyTip.split(":").map(Number);

  const entry = {
    loggedAt: new Date().toISOString(),
    season: FORWARD_SEASON,
    matchday,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    kickoff: fixture.date,
    configHash: hash,
    scheme: scheme.key,
    form: { home: homeForm, away: awayForm },
    market: fixtureOdds
      ? {
          fetchedAt: oddsCache!.fetchedAt,
          bookmakers: fixtureOdds.bookmakers,
          probs: market1x2,
          totalsLines: fixtureOdds.totals?.length ?? 0,
          spreadLines: fixtureOdds.spread?.length ?? 0,
        }
      : null,
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
      full: variantOf(full),
      withLlm: variantOf(withLlm),
      market1x2: variantOf(marketOnly1x2),
      modelOnly: variantOf(modelOnly),
      legacyArgmax: {
        tip: legacyTip,
        expectedPoints: expectedPointsForTip(modelOnly.matrix, legacyHome, legacyAway, scheme),
        probs: modelOnly.finalProbs,
        expectedGoals: [modelOnly.expectedHomeGoals, modelOnly.expectedAwayGoals],
        constraints: [],
      },
    },
  };

  appendFileSync(LOG_PATH, `${JSON.stringify(entry)}\n`);
  written++;

  console.log(
    `  ${fixture.homeTeam} vs ${fixture.awayTeam}: ${full.tip.tip} ` +
      `(EV ${full.tip.expectedPoints.toFixed(2)}, alt ${legacyTip})`
  );
}

function variantOf(out: ReturnType<typeof predictPipeline>) {
  return {
    tip: out.tip.tip,
    expectedPoints: out.tip.expectedPoints,
    runnerUpTip: out.tip.runnerUpTip,
    probs: out.finalProbs,
    expectedGoals: [out.expectedHomeGoals, out.expectedAwayGoals],
    constraints: out.marketConstraints,
  };
}

console.log(
  `\nSpieltag ${matchday}: ${written} protokolliert, ${skipped} uebersprungen ` +
    `(bereits im Log oder angepfiffen).`
);
if (withoutOdds > 0) {
  console.log(`${withoutOdds} Spiele ohne Marktquoten -- dort fallen alle Varianten zusammen.`);
}
console.log(`Konfiguration ${hash}, Schema "${scheme.label}". Log: data/forward_log.jsonl`);
