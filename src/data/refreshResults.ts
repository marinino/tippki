import { parse } from "csv-parse/sync";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { OPENLIGADB_TO_OUR_NAME } from "./openligaTeamNames";
import { seasonToFilenameSuffix } from "./loadMatches";
import { refreshMarketOdds } from "./refreshMarketOdds";

const DATA_DIR = join(process.cwd(), "data");

interface OpenLigaMatchResult {
  matchDateTime: string;
  team1: { teamName: string };
  team2: { teamName: string };
  matchIsFinished: boolean;
  matchResults: { resultTypeID: number; pointsTeam1: number; pointsTeam2: number }[];
}

function formatDateForCsv(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

async function refreshCsvResults(season: string): Promise<number> {
  const res = await fetch(`https://api.openligadb.de/getmatchdata/bl1/${season}`);
  if (!res.ok) throw new Error(`OpenLigaDB-Abruf fehlgeschlagen: ${res.status}`);
  const matches: OpenLigaMatchResult[] = await res.json();

  const rows = matches
    .filter((m) => m.matchIsFinished)
    .map((m) => {
      const finalResult = m.matchResults.find((r) => r.resultTypeID === 2);
      const homeTeam = OPENLIGADB_TO_OUR_NAME[m.team1.teamName] ?? m.team1.teamName;
      const awayTeam = OPENLIGADB_TO_OUR_NAME[m.team2.teamName] ?? m.team2.teamName;
      return {
        Div: "D1",
        Date: formatDateForCsv(m.matchDateTime),
        HomeTeam: homeTeam,
        AwayTeam: awayTeam,
        FTHG: finalResult?.pointsTeam1 ?? "",
        FTAG: finalResult?.pointsTeam2 ?? "",
        FTR:
          finalResult == null
            ? ""
            : finalResult.pointsTeam1 > finalResult.pointsTeam2
              ? "H"
              : finalResult.pointsTeam1 === finalResult.pointsTeam2
                ? "D"
                : "A",
      };
    })
    .filter((r) => r.FTHG !== "" && r.FTAG !== "");

  const filePath = join(DATA_DIR, `D1_${seasonToFilenameSuffix(season)}.csv`);
  writeCsvMerged(filePath, rows);
  return rows.length;
}

const MINIMAL_HEADER = ["Div", "Date", "HomeTeam", "AwayTeam", "FTHG", "FTAG", "FTR"];

export interface ResultRow {
  Div: string;
  Date: string;
  HomeTeam: string;
  AwayTeam: string;
  FTHG: number | string;
  FTAG: number | string;
  FTR: string;
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function matchKey(date: string, homeTeam: string, awayTeam: string): string {
  return `${date}|${homeTeam}|${awayTeam}`;
}

// Bis hierher wurde die Saisondatei komplett mit sieben Spalten ueberschrieben. Damit hat
// jeder Klick auf "Ergebnisse aktualisieren" saemtliche Quotenspalten der LAUFENDEN Saison
// geloescht -- also genau die Daten, aus denen die markt-implizierten Torerwartungen kommen,
// und genau fuer die Saison, um die es geht. Deshalb jetzt ein Merge: bestehende Zeilen
// behalten alle ihre Spalten, aktualisiert werden nur FTHG/FTAG/FTR.
export function writeCsvMerged(filePath: string, rows: ResultRow[]): void {
  if (!existsSync(filePath)) {
    writeFileSync(filePath, `${MINIMAL_HEADER.join(",")}\n${rows.map(minimalLine).join("\n")}\n`);
    return;
  }

  const existing: Record<string, string>[] = parse(readFileSync(filePath, "utf-8"), {
    columns: true,
    skip_empty_lines: true,
    bom: true,
  });

  // csv-parse liefert die Spaltennamen in Dateireihenfolge; ueber die erste Zeile bleibt die
  // Originalreihenfolge (und damit die Datei-Struktur) erhalten.
  const header = existing.length > 0 ? Object.keys(existing[0]) : [...MINIMAL_HEADER];
  for (const column of MINIMAL_HEADER) {
    if (!header.includes(column)) header.push(column);
  }

  const byKey = new Map(rows.map((r) => [matchKey(r.Date, r.HomeTeam, r.AwayTeam), r]));
  const seen = new Set<string>();

  const merged = existing.map((row) => {
    const key = matchKey(row.Date, row.HomeTeam, row.AwayTeam);
    const update = byKey.get(key);
    if (!update) return row;
    seen.add(key);
    return { ...row, FTHG: String(update.FTHG), FTAG: String(update.FTAG), FTR: update.FTR };
  });

  // Spiele, die noch gar nicht in der Datei stehen (z.B. neu angesetzte Partien), anhaengen.
  for (const [key, row] of byKey) {
    if (seen.has(key)) continue;
    const fresh: Record<string, string> = Object.fromEntries(header.map((c) => [c, ""]));
    fresh.Div = row.Div;
    fresh.Date = row.Date;
    fresh.HomeTeam = row.HomeTeam;
    fresh.AwayTeam = row.AwayTeam;
    fresh.FTHG = String(row.FTHG);
    fresh.FTAG = String(row.FTAG);
    fresh.FTR = row.FTR;
    merged.push(fresh);
  }

  const body = merged
    .map((row) => header.map((column) => csvEscape(row[column] ?? "")).join(","))
    .join("\n");

  writeFileSync(filePath, `${header.join(",")}\n${body}\n`);
}

function minimalLine(r: ResultRow): string {
  return [r.Div, r.Date, r.HomeTeam, r.AwayTeam, r.FTHG, r.FTAG, r.FTR].join(",");
}

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

async function refreshXgResults(season: string): Promise<number> {
  const res = await fetch(`https://understat.com/getLeagueData/Bundesliga/${season}`, {
    headers: { "X-Requested-With": "XMLHttpRequest", "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) throw new Error(`Understat-Abruf fehlgeschlagen: ${res.status}`);
  const data: any = await res.json();

  const newMatches: XgMatch[] = (data.dates as any[])
    .filter((m) => m.isResult)
    .map((m) => ({
      season,
      date: m.datetime,
      homeTeam: m.h.title,
      awayTeam: m.a.title,
      homeGoals: Number(m.goals.h),
      awayGoals: Number(m.goals.a),
      homeXG: Number(m.xG.h),
      awayXG: Number(m.xG.a),
    }));

  const xgPath = join(DATA_DIR, "xg_bundesliga.json");
  const existing: XgMatch[] = existsSync(xgPath) ? JSON.parse(readFileSync(xgPath, "utf-8")) : [];
  const withoutThisSeason = existing.filter((m) => m.season !== season);
  const merged = [...withoutThisSeason, ...newMatches].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  writeFileSync(xgPath, JSON.stringify(merged));

  return newMatches.length;
}

export interface RefreshSummary {
  season: string;
  resultsCount: number;
  xgCount: number;
  // Spiele der laufenden Saison, die nach dem Abruf eine Buchmacher-Schlussquote tragen.
  // null = football-data fuehrt die Saison noch nicht oder war nicht erreichbar.
  oddsCount: number | null;
}

export async function refreshSeasonData(season: string): Promise<RefreshSummary> {
  const [resultsCount, xgCount] = await Promise.all([refreshCsvResults(season), refreshXgResults(season)]);

  // Bewusst NACH den Ergebnissen und bewusst nicht-fatal: die Quoten sind Massstab, nicht
  // Betriebsgrundlage. Faellt football-data aus, laeuft die App vollstaendig weiter, nur der
  // Vergleich mit dem Buchmacher fehlt fuer die betroffenen Spieltage.
  let oddsCount: number | null = null;
  try {
    const market = await refreshMarketOdds(season);
    if (market.published) {
      oddsCount = Math.max(market.withPinnacleClose, market.withAverageClose);
    }
  } catch {
    oddsCount = null;
  }

  return { season, resultsCount, xgCount, oddsCount };
}
