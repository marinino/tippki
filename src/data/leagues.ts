// Die fuenf Ligen der Mehrliga-Messbasis -- NUR fuer die Auswertung.
//
// Produktiv rechnet das Modell ausschliesslich Bundesliga (loadAllMatches), und daran aendert
// diese Datei nichts. Die vier anderen Ligen sind ein Messgeraet: auf 1.529 Bundesliga-Spielen
// sind Unterschiede um 0,001 RPS nicht aufloesbar (MESSLAUF.md: sieben Kandidaten, kein
// Nachweis). Mit Premier League, La Liga, Serie A und Ligue 1 dazu sind es rund sechsmal so
// viele Spiele, die Intervalle werden rund zweieinhalbmal enger, und ein Befund, der in fuenf
// Ligen traegt, ist weniger wahrscheinlich eine Eigenheit von fuenf Bundesliga-Saisons. Dass
// das auch umgekehrt gilt, hat die Recherche gezeigt: ρ ist ligaabhaengig (RECHERCHE.md,
// Abschnitt 2) -- die anderen Ligen ersetzen die Bundesliga also nicht, sie pruefen Mechanismen.
//
// Woher die Daten kommen: football-data.co.uk, dieselben Dateien und Spalten wie die
// Bundesliga, Saisons 2014/15 bis 2025/26, abgelegt unter ligen/ statt data/. Grund:
// next.config.mjs packt data/** in jedes Serverbuendel, und die fremden Ligen haben in der App
// nichts verloren. Die Dateien aendern sich nicht mehr (abgeschlossene Saisons) und werden von
// keiner Automatik gepflegt. Es gibt fuer sie KEINE xG-Daten: target "blend" rechnet dort mit
// Toren, und die Form kommt aus Torschuessen aufs Tor (src/eval/leagueBacktest.ts).
//
// Welche Saisons wofuer da sind, steht in src/eval/leagueBacktest.ts und MESSLAUF.md,
// Abschnitt "Mehrliga-Messbasis": 2016/17 bis 2022/23 Entwicklung, 2023/24 bis 2025/26
// unberuehrt.

import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadAllMatches, parseCsvFile, seasonToFilenameSuffix, type Match } from "./loadMatches";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const LEAGUE_DATA_DIR = join(__dirname, "..", "..", "ligen");

export type LeagueCode = "D1" | "E0" | "SP1" | "I1" | "F1";

export interface League {
  code: LeagueCode;
  name: string;
}

// Bundesliga zuerst: sie ist die Liga, um die es geht, und die einzige mit xG.
export const LEAGUES: readonly League[] = [
  { code: "D1", name: "Bundesliga" },
  { code: "E0", name: "Premier League" },
  { code: "SP1", name: "La Liga" },
  { code: "I1", name: "Serie A" },
  { code: "F1", name: "Ligue 1" },
];

// Startjahre der Saisons, die fuer die vier fremden Ligen unter ligen/ liegen.
export const LEAGUE_SEASONS = ["2014", "2015", "2016", "2017", "2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025"];

const cache = new Map<LeagueCode, Match[]>();

// Alle Spiele einer Liga, chronologisch nicht sortiert (wie loadAllMatches; wer eine Zeitachse
// braucht, sortiert selbst). Fuer die Bundesliga ist das EXAKT loadAllMatches() -- dieselbe
// Instanz, damit Modell-Cache und xG-Form dieselben Spiele sehen wie produktiv.
export function loadLeagueMatches(code: LeagueCode): Match[] {
  if (code === "D1") return loadAllMatches();
  const cached = cache.get(code);
  if (cached) return cached;

  const matches: Match[] = [];
  for (const season of LEAGUE_SEASONS) {
    const file = join(LEAGUE_DATA_DIR, `${code}_${seasonToFilenameSuffix(season)}.csv`);
    if (!existsSync(file)) {
      throw new Error(`Mehrliga-Messbasis: ${file} fehlt (siehe src/data/leagues.ts, Herkunft der Daten)`);
    }
    matches.push(...parseCsvFile(file, season));
  }
  cache.set(code, matches);
  return matches;
}

export function leagueName(code: LeagueCode): string {
  return LEAGUES.find((l) => l.code === code)!.name;
}

// Mannschaften einer Saison. Ligue 1 spielt ab 2023/24 mit 18 statt 20 -- deshalb je Saison und
// nicht je Liga.
export function teamsInSeason(matches: Match[], season: string): number {
  return new Set(matches.filter((m) => m.season === season).flatMap((m) => [m.homeTeam, m.awayTeam])).size;
}

// Spiele je Spieltag: der Block, vor dem der Walk-forward neu fittet (MATCHES_PER_REFIT ist die
// Bundesliga-Zahl 9).
export function matchesPerRound(matches: Match[], season: string): number {
  return teamsInSeason(matches, season) / 2;
}
