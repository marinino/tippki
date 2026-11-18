// Friert die Vorhersage kurz vor Anpfiff ein (VERBESSERUNGEN.md, Punkt 12).
//
//   npm run kickoff-snapshot
//
// Laeuft bei jedem Tick des Spielkontext-Workflows. Schreibt fuer jede Partie, deren
// Anpfiff zwischen SNAPSHOT_EARLIEST_MINUTES und SNAPSHOT_LATEST_MINUTES entfernt ist und
// die noch keinen Schnappschuss hat, genau eine Zeile nach data/kickoff_snapshots.jsonl.
// Regeln und Begruendung: src/data/kickoffSnapshots.ts.
//
// Ohne Argumente mit Absicht: kein --force, kein --matchday. Ein Schnappschuss ausserhalb
// des Fensters waere nicht der Stand bei Anpfiff, und genau dafuer steht die Datei.
//
// Keine Abrufe, kein Geld: gerechnet wird aus dem, was im Repo steht -- dasselbe, was die
// gehostete Seite in diesem Moment rechnet.

import { readFileSync } from "fs";
import { join } from "path";
import { parseKickoff } from "../data/kickoff";
import { loadAllMatches } from "../data/loadMatches";
import { PRODUCTION_MODEL_OPTIONS, buildLeagueModel, type LeagueModel } from "../model/teamStrength";
import { configHash } from "../model/pipelineConfig";
import { FORWARD_SEASON } from "../eval/splits";
import { readLlmCache } from "../llm/llmCache";
import { liveDisplayNumbers } from "../data/displayPredictions";
import {
  appendKickoffSnapshot,
  readKickoffSnapshots,
  snapshotDecision,
  snapshotKey,
} from "../data/kickoffSnapshots";

interface Fixture {
  homeTeam: string;
  awayTeam: string;
  date: string;
  matchday: number;
}

const fixtures: Fixture[] = JSON.parse(readFileSync(join(process.cwd(), "data", "fixtures.json"), "utf-8"));
const now = new Date();
const frozen = new Set(readKickoffSnapshots().map(snapshotKey));

const decisions = fixtures.map((f) => ({
  f,
  decision: snapshotDecision(
    parseKickoff(f.date),
    now,
    frozen.has(snapshotKey({ season: FORWARD_SEASON, ...f, kickoff: f.date }))
  ),
}));
const due = decisions.filter((d) => d.decision === "faellig").map((d) => d.f);
// "vorhanden" zaehlt nur fuer Partien, die noch nicht angepfiffen sind -- sonst stuende hier
// jede eingefrorene Partie der Saison.
const alreadyFrozen = decisions.filter(
  (d) => d.decision === "vorhanden" && parseKickoff(d.f.date).getTime() > now.getTime()
);

if (due.length === 0) {
  console.log(
    alreadyFrozen.length > 0
      ? `Nichts Neues: ${alreadyFrozen.map((d) => `${d.f.homeTeam} vs ${d.f.awayTeam}`).join(", ")} bereits eingefroren.`
      : "Kein Anpfiff im Fenster -- nichts einzufrieren."
  );
  process.exit(0);
}

// Erst nach der Pruefung: ein Fit kostet wenig, aber an 95 von 100 Ticks gar nichts zu
// fitten ist noch billiger.
const model: LeagueModel = buildLeagueModel(loadAllMatches(), PRODUCTION_MODEL_OPTIONS);
const llmCache = readLlmCache();
// Derselbe Hash wie in der Route-Anzeige: die Voreinstellung. Der Schnappschuss haelt fest,
// was die Seite zeigt, und die rechnet mit DEFAULT_PIPELINE.
const hash = configHash();

for (const f of due) {
  const cacheForMatchday = llmCache && llmCache.matchday === f.matchday ? llmCache : null;
  const numbers = liveDisplayNumbers(model, f, cacheForMatchday);
  appendKickoffSnapshot({
    frozenAt: now.toISOString(),
    season: FORWARD_SEASON,
    matchday: f.matchday,
    homeTeam: f.homeTeam,
    awayTeam: f.awayTeam,
    kickoff: f.date,
    configHash: hash,
    numbers,
  });
  const minutes = Math.round((parseKickoff(f.date).getTime() - now.getTime()) / 60000);
  console.log(
    `Eingefroren: Spieltag ${f.matchday}, ${f.homeTeam} vs ${f.awayTeam} (Anpfiff in ${minutes} min) -- ` +
      `1X2 ${(numbers.homeWinProb * 100).toFixed(1)} / ${(numbers.drawProb * 100).toFixed(1)} / ` +
      `${(numbers.awayWinProb * 100).toFixed(1)} %, ${numbers.llmStatus}`
  );
}
