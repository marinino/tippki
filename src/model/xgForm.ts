import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { OUR_NAME_TO_UNDERSTAT } from "../data/understatTeamNames";
import { loadAllMatches, parseMatchDate, deriveSeasonFromDate } from "../data/loadMatches";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface XgMatch {
  season: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
  homeXG: number;
  awayXG: number;
}

// Anzahl der letzten Spiele fuer die xG-Formkurve. Kurzfristiges xG (statt Tore) ist ein
// deutlich rauschaermeres Signal fuer die aktuelle Form als Tordifferenz -- bestaetigt durch
// Backtests hier im Projekt und durch eine Bundesliga-Studie (Wilkens 2026), die denselben
// Ansatz (rollierendes xG der letzten 3 Spiele) nutzt.
export const XG_FORM_WINDOW = 3;

// Wie stark die xG-Formkurve die erwarteten Tore beeinflusst (multiplikativ via exp(beta * form)).
export const XG_FORM_WEIGHT = 0.2;

// Vorberechnete Indizes statt linearer Scans.
//
// Vorher lief computeXgForm zweimal pro Vorhersage ueber alle 3672 xG-Spiele und alle 3672
// eigenen Spiele, mit je einem new Date() pro Element im Filter-Praedikat. Ueber einen
// vollen Backtest waren das rund 18 Millionen Date-Konstruktionen -- der mit Abstand
// teuerste Posten. Mit sortierten Per-Team-Listen wird daraus eine Binaersuche plus eine
// Fenstersumme.
interface TeamXgEntry {
  time: number;
  xgDiff: number;
}

let xgByTeam: Map<string, TeamXgEntry[]> | null = null;
let ownKickoffsByTeamSeason: Map<string, number[]> | null = null;

function pushInto<T>(index: Map<string, T[]>, key: string, value: T): void {
  const existing = index.get(key);
  if (existing) existing.push(value);
  else index.set(key, [value]);
}

function buildXgIndex(): Map<string, TeamXgEntry[]> {
  const raw = readFileSync(join(__dirname, "..", "..", "data", "xg_bundesliga.json"), "utf-8");
  const matches: XgMatch[] = JSON.parse(raw);

  // Erst global chronologisch sortieren, dann in Team-Buckets schieben. Dadurch ist jede
  // Team-Liste eine Teilfolge der global sortierten Reihenfolge -- inklusive der stabilen
  // Reihenfolge bei zeitgleichen Anstossen. Das war vorher implizit so und muss es bleiben,
  // sonst verschiebt sich das Formfenster an Spieltagen mit parallelen Anstossen.
  const sorted = [...matches].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const index = new Map<string, TeamXgEntry[]>();
  for (const m of sorted) {
    const time = new Date(m.date).getTime();
    pushInto(index, m.homeTeam, { time, xgDiff: m.homeXG - m.awayXG });
    pushInto(index, m.awayTeam, { time, xgDiff: m.awayXG - m.homeXG });
  }
  return index;
}

function buildOwnKickoffIndex(): Map<string, number[]> {
  const index = new Map<string, number[]>();
  for (const m of loadAllMatches()) {
    const time = parseMatchDate(m.date).getTime();
    pushInto(index, `${m.homeTeam}|${m.season}`, time);
    pushInto(index, `${m.awayTeam}|${m.season}`, time);
  }
  for (const times of index.values()) times.sort((a, b) => a - b);
  return index;
}

// Muss nach einem Datenupdate (siehe refreshResults.ts) aufgerufen werden, sonst wuerden
// die alten, im Prozess zwischengespeicherten Match-/xG-Daten weiterverwendet.
export function clearXgFormCache(): void {
  xgByTeam = null;
  ownKickoffsByTeamSeason = null;
}

// Anzahl der Eintraege mit time < beforeTime. Entspricht exakt der Laenge des frueheren
// .filter(... < beforeDate) -- der Vergleich war und bleibt strikt, Spiele am selben
// Stichtag zaehlen also nicht mit.
function countBefore(times: readonly number[], beforeTime: number): number {
  let low = 0;
  let high = times.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (times[mid] < beforeTime) low = mid + 1;
    else high = mid;
  }
  return low;
}

function countBeforeEntries(entries: readonly TeamXgEntry[], beforeTime: number): number {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (entries[mid].time < beforeTime) low = mid + 1;
    else high = mid;
  }
  return low;
}

// Zaehlt, wie viele Ligaspiele ein Team in der zu `beforeDate` gehoerenden Saison bereits
// bestritten hat. Damit laesst sich das Formfenster am Saisonstart hochfahren, statt sofort
// mit Spielen aus der Vorsaison zu rechnen (an Spieltag 1 ist die Formkurve sonst veraltet).
function gamesPlayedThisSeason(ourTeamName: string, beforeDate: Date): number {
  if (!ownKickoffsByTeamSeason) ownKickoffsByTeamSeason = buildOwnKickoffIndex();
  const season = deriveSeasonFromDate(beforeDate);
  const times = ownKickoffsByTeamSeason.get(`${ourTeamName}|${season}`);
  if (!times) return 0;
  return countBefore(times, beforeDate.getTime());
}

// Durchschnittliche xG-Differenz (erzielt minus zugelassen) der letzten Spiele eines Teams vor
// `beforeDate`. Das Fenster faehrt am Saisonstart hoch (0 an Spieltag 1, 1 an Spieltag 2, ...,
// ab Spieltag XG_FORM_WINDOW+1 das volle Fenster), damit keine veralteten Vorsaison-Spiele in
// die Form der neuen Saison einfliessen. 0, wenn kein Teamname-Mapping oder keine Historie existiert.
export function computeXgForm(ourTeamName: string, beforeDate: Date): number {
  const understatName = OUR_NAME_TO_UNDERSTAT[ourTeamName];
  if (!understatName) return 0;

  const n = Math.min(gamesPlayedThisSeason(ourTeamName, beforeDate), XG_FORM_WINDOW);
  if (n === 0) return 0;

  if (!xgByTeam) xgByTeam = buildXgIndex();
  const entries = xgByTeam.get(understatName);
  if (!entries) return 0;

  const available = countBeforeEntries(entries, beforeDate.getTime());
  const start = Math.max(0, available - n);
  const count = available - start;
  if (count === 0) return 0;

  let totalXgDiff = 0;
  for (let i = start; i < available; i++) totalXgDiff += entries[i].xgDiff;

  return totalXgDiff / count;
}
