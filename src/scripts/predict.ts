// Preisblatt fuer den naechsten Spieltag.
//
//   npm run predict
//   npm run predict -- --matchday=12
//   npm run predict -- --full        (alle Linien und die Correct-Score-Liste)
//
// Ausgegeben werden faire Quoten, also OHNE Marge. Ein Buchmacher schlaegt darauf noch
// seinen Aufschlag; die Kehrwerte der Zahlen hier summieren je Markt exakt auf 1.

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadEnvLocal } from "../data/loadEnv";
import { nextMatchdayOf, parseKickoff } from "../data/kickoff";
import { predictPipeline } from "../model/predictPipeline";
import { livePipelineFor, liveModelFor } from "../model/livePipeline";
import { configHash } from "../model/pipelineConfig";
import { computeXgForm } from "../model/xgForm";
import { formatOdds } from "../model/priceSheet";
import { cacheKey, readLlmCache } from "../llm/llmCache";

loadEnvLocal();

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = join(__dirname, "..", "..", "data", "fixtures.json");

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

const full = process.argv.includes("--full");

const allFixtures: Fixture[] = JSON.parse(readFileSync(FIXTURES_PATH, "utf-8"));

// nextMatchdayOf und parseKickoff wie Route und forward-log: fixtures.json fuehrt keine
// Zeitzone, und new Date() laese die Anstosszeiten auf einem Rechner in UTC zwei Stunden
// daneben. nextMatchdayOf haelt ausserdem eine verlegte Partie nicht faelschlich fuer den
// naechsten Spieltag (siehe kickoff.ts).
const matchday = flag("matchday") ? Number(flag("matchday")) : nextMatchdayOf(allFixtures);

if (matchday == null) {
  console.error("Kein kommender Spieltag gefunden.");
  process.exit(0);
}

const fixtures = allFixtures.filter((f) => f.matchday === matchday);
// Die Pipeline, mit der die Seite diesen Spieltag rechnet (ab Spieltag 11 der Kandidat).
const pipeline = livePipelineFor(matchday);
const model = liveModelFor(pipeline);

// Nur lesen, nie abrufen. Der LLM-Refresh kostet Geld und laeuft ausschliesslich auf
// ausdruecklichen Knopfdruck (npm run refresh-llm).
const llmCache = readLlmCache();
const llmByFixture = llmCache && llmCache.matchday === matchday ? llmCache.contexts : {};

console.log(`Spieltag ${matchday} -- faire Quoten, ohne Marge`);
console.log(
  pipeline.variant === "kandidat-2027"
    ? `Pipeline: Kandidat 2027/28, configHash ${configHash(pipeline.config)} (live ab Spieltag 11)\n`
    : `Pipeline: eingefroren 2026, configHash ${configHash(pipeline.config)}\n`
);

for (const { homeTeam, awayTeam, date } of fixtures) {
  const matchDate = parseKickoff(date);
  const cachedLlm = llmByFixture[cacheKey(homeTeam, awayTeam)];
  const homeForm = computeXgForm(homeTeam, matchDate);
  const awayForm = computeXgForm(awayTeam, matchDate);

  const out = predictPipeline({
    ...pipeline.options,
    model,
    homeTeam,
    awayTeam,
    homeForm,
    awayForm,
    llmContext: cachedLlm?.context ?? null,
  });

  // Dieselbe Partie ohne Formkurve, sonst alles gleich (auch der Spielkontext). Nur zum
  // Ansehen: angezeigt, geloggt und eingefroren wird weiter die Vorhersage MIT Form.
  //
  // Die Form ist ungeklammert (VERBESSERUNGEN.md, Punkt 6) und erzeugt den groessten Teil
  // der deutlichen Abweichungen vom Markt -- ueber die Validation 54 % des gesamten
  // Rueckstands auf 8 % der Spiele (npm run form, Abschnitt 4). Mit dieser Zeile ist jede
  // Woche zu sehen, ob eine Abweichung vom Buchmacher aus ihr kommt. Am Spieltag 10 waren
  // es drei von vier: Bayern 6:0 statt 3:0, Union-Leipzig 0:2 statt 1:1, Leverkusen 50 %
  // statt 59 %.
  const noForm = predictPipeline({
    ...pipeline.options,
    model,
    homeTeam,
    awayTeam,
    homeForm: 0,
    awayForm: 0,
    llmContext: cachedLlm?.context ?? null,
  });

  const p = out.prices;
  const homeLabel = out.homeIsEstimated ? `${homeTeam} (geschätzt, Aufsteiger?)` : homeTeam;
  const awayLabel = out.awayIsEstimated ? `${awayTeam} (geschätzt, Aufsteiger?)` : awayTeam;

  console.log(`${homeLabel} vs ${awayLabel}`);
  console.log(
    `  erwartete Tore ${out.expectedHomeGoals.toFixed(2)} : ${out.expectedAwayGoals.toFixed(2)}` +
      (out.llmAdjustment ? "  (mit Spielkontext)" : "")
  );
  console.log(
    `  1X2       1 ${formatOdds(p.outcome.home)} (${(p.outcome.home.prob * 100).toFixed(1)}%)   ` +
      `X ${formatOdds(p.outcome.draw)} (${(p.outcome.draw.prob * 100).toFixed(1)}%)   ` +
      `2 ${formatOdds(p.outcome.away)} (${(p.outcome.away.prob * 100).toFixed(1)}%)`
  );
  const signed = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(2)}`;
  const modeWithout = noForm.prices.correctScore[0].score;
  const modeWith = p.correctScore[0].score;
  console.log(
    `  ohne Form ${noForm.expectedHomeGoals.toFixed(2)} : ${noForm.expectedAwayGoals.toFixed(2)}   ` +
      `1X2 ${(noForm.probs.homeWinProb * 100).toFixed(1)}% / ${(noForm.probs.drawProb * 100).toFixed(1)}% / ` +
      `${(noForm.probs.awayWinProb * 100).toFixed(1)}%   Häufigstes ${modeWithout}` +
      `${modeWithout === modeWith ? "" : ` (mit Form ${modeWith})`}   ` +
      `Form ${signed(homeForm)} / ${signed(awayForm)}`
  );
  console.log(
    `  Doppelt   1X ${formatOdds(p.doubleChance.homeOrDraw)}   ` +
      `12 ${formatOdds(p.doubleChance.homeOrAway)}   ` +
      `X2 ${formatOdds(p.doubleChance.drawOrAway)}`
  );
  console.log(
    `  BTTS      Ja ${formatOdds(p.bothTeamsToScore.yes)}   Nein ${formatOdds(p.bothTeamsToScore.no)}`
  );

  const totalsShown = full ? p.totals : p.totals.filter((t) => t.line >= 1.5 && t.line <= 3.5);
  console.log(
    `  Torsumme  ` +
      totalsShown
        .map((t) => `${t.line} Ü ${formatOdds(t.over)} / U ${formatOdds(t.under)}`)
        .join("   ")
  );

  const hcShown = full ? p.handicaps : p.handicaps.filter((h) => Math.abs(h.line) <= 1.5);
  console.log(
    `  Handicap  ` +
      hcShown
        .map((h) => `${h.line > 0 ? "+" : ""}${h.line} H ${formatOdds(h.home)} / A ${formatOdds(h.away)}`)
        .join("   ")
  );

  const scores = full ? p.correctScore : p.correctScore.slice(0, 6);
  console.log(
    `  Ergebnis  ` + scores.map((c) => `${c.score} ${formatOdds(c.price)}`).join("   ")
  );
  console.log("");
}

console.log(
  `Die Zahlen stammen ausschliesslich aus Teamstaerken, Formkurve und Spielkontext --\n` +
    `keine Buchmacherquote geht ein. Wie sie sich gegen den Markt schlagen, zeigt\n` +
    `"npm run benchmark".`
);
