import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { isAdminRequest } from "../../../data/adminAuth";
import { isReadOnlyDeployment } from "../../../data/deployment";
import { nextMatchdayOf, parseKickoff } from "../../../data/kickoff";
import { loadAllMatches } from "../../../data/loadMatches";
import { PRODUCTION_MODEL_OPTIONS, buildLeagueModel, type LeagueModel } from "../../../model/teamStrength";
import { readLlmCache } from "../../../llm/llmCache";
import { FORWARD_SEASON } from "../../../eval/splits";
import {
  displayNumbersFromLog,
  liveDisplayNumbers,
  type LoggedRow,
} from "../../../data/displayPredictions";
import { chooseDisplaySource, readKickoffSnapshots } from "../../../data/kickoffSnapshots";
import type { Prediction } from "../../types";

function readForwardLog(): LoggedRow[] {
  const path = join(process.cwd(), "data", "forward_log.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as LoggedRow];
      } catch {
        return [];
      }
    });
}

interface Fixture {
  homeTeam: string;
  awayTeam: string;
  date: string;
  matchday: number;
}

export async function GET(request: Request) {
  const fixturesPath = join(process.cwd(), "data", "fixtures.json");
  const allFixtures: Fixture[] = JSON.parse(readFileSync(fixturesPath, "utf-8"));

  const logosPath = join(process.cwd(), "data", "teamLogos.json");
  const logosByTeam: Record<string, string> = JSON.parse(readFileSync(logosPath, "utf-8"));

  const availableMatchdays = [...new Set(allFixtures.map((f) => f.matchday))].sort((a, b) => a - b);

  // parseKickoff, nicht new Date: diese Route laeuft in der Cloud unter UTC, und ein
  // zonenloser Zeitstempel wuerde dort jeden Anpfiff zwei Stunden spaeter verorten -- der
  // Spieltag bliebe nach dem letzten Anpfiff noch zwei Stunden lang der "naechste".
  const nextMatchday = nextMatchdayOf(allFixtures);

  const params = new URL(request.url).searchParams;
  const requestedParam = params.get("matchday");
  const requestedMatchday = requestedParam ? Number(requestedParam) : null;
  const selectedMatchday =
    requestedMatchday && availableMatchdays.includes(requestedMatchday)
      ? requestedMatchday
      : nextMatchday;

  const fixtures = allFixtures.filter((f) => f.matchday === selectedMatchday);

  // Kein Live-Abruf hier -- nur lesen, was zuletzt ueber den manuellen Knopf geholt wurde.
  // Ein Kontext aus einem anderen Spieltag waere schlimmer als keiner.
  const llmCache = readLlmCache();
  const cacheForMatchday =
    llmCache && llmCache.matchday === selectedMatchday ? llmCache : null;

  // Was bei Anpfiff dastand, wird nie wieder veraendert (src/data/kickoffSnapshots.ts).
  // Eingefrorene Partien kommen aus dem Schnappschuss, angepfiffene ohne Schnappschuss aus
  // dem Vorwaerts-Log, und nur die uebrigen werden live gerechnet. Der Fit faellt damit fuer
  // jeden vergangenen Spieltag ganz weg.
  const now = new Date();
  const snapshots = readKickoffSnapshots();
  const logRows = readForwardLog();
  let model: LeagueModel | null = null;
  const liveModel = () => (model ??= buildLeagueModel(loadAllMatches(), PRODUCTION_MODEL_OPTIONS));

  const predictions = fixtures.map((fixture): Prediction => {
    const { homeTeam, awayTeam, date } = fixture;
    const head = {
      homeTeam,
      awayTeam,
      homeLogo: logosByTeam[homeTeam] ?? null,
      awayLogo: logosByTeam[awayTeam] ?? null,
      date,
    };
    const source = chooseDisplaySource({
      season: FORWARD_SEASON,
      fixture,
      kickoff: parseKickoff(date),
      now,
      snapshots,
      logRows,
    });
    switch (source.kind) {
      case "anpfiff":
        return { ...head, ...source.snapshot.numbers, source: { kind: "anpfiff", at: source.snapshot.frozenAt } };
      case "vorwaertslog":
        return { ...head, ...displayNumbersFromLog(source.row), source: { kind: "vorwaertslog", at: source.row.loggedAt } };
      case "fehlt":
        return { ...head, source: { kind: "fehlt" } };
      case "live":
        return { ...head, ...liveDisplayNumbers(liveModel(), fixture, cacheForMatchday), source: { kind: "live" } };
    }
  });

  return Response.json({
    predictions,
    matchday: selectedMatchday,
    nextMatchday,
    availableMatchdays,
    llmFetchedAt: cacheForMatchday ? cacheForMatchday.fetchedAt : null,
    llmModel: cacheForMatchday ? cacheForMatchday.model : null,
    // Ohne diese Zahlen ist "ohne Befund" nicht von "hat nie gesucht" zu unterscheiden --
    // genau der blinde Fleck, der Spieltag 1 gekostet hat. undefined bei Staenden von vor
    // dem 01.09.2026.
    llmRun: cacheForMatchday?.usage
      ? {
          webSearches: cacheForMatchday.usage.webSearches,
          researchChars: cacheForMatchday.usage.researchChars,
          searchErrors: cacheForMatchday.usage.searchErrors,
          costUsd: cacheForMatchday.usage.costUsd,
        }
      : null,
    // Die UI blendet danach die beiden Aktualisierungsknoepfe aus. Der Weg ueber diese
    // Antwort statt ueber eine NEXT_PUBLIC_-Variable spart einen Konfigurationsschritt
    // beim Hoster -- und einen, den man vergessen kann.
    readOnly: isReadOnlyDeployment(),
    // Angemeldeter Admin: die Knoepfe kommen zurueck, loesen dann aber den Workflow aus.
    // Die Sichtbarkeit ist Bequemlichkeit, die Sperre sitzt in den Routen selbst.
    admin: isAdminRequest(request),
  });
}
