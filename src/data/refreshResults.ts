import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { OPENLIGADB_TO_OUR_NAME } from "./openligaTeamNames";

const DATA_DIR = join(process.cwd(), "data");

interface OpenLigaMatchResult {
  matchDateTime: string;
  team1: { teamName: string };
  team2: { teamName: string };
  matchIsFinished: boolean;
  matchResults: { resultTypeID: number; pointsTeam1: number; pointsTeam2: number }[];
}

// Saison-Code wie "2026" -> Dateiname-Suffix "2627" (Startjahr + Folgejahr, je zwei Ziffern),
// passend zur bestehenden football-data.co.uk-Namenskonvention unserer CSV-Dateien.
function seasonToFilenameSuffix(season: string): string {
  const startYear = Number(season);
  return String(startYear % 100).padStart(2, "0") + String((startYear + 1) % 100).padStart(2, "0");
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

  const header = "Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,FTR";
  const csvBody = rows
    .map((r) => [r.Div, r.Date, r.HomeTeam, r.AwayTeam, r.FTHG, r.FTAG, r.FTR].join(","))
    .join("\n");

  const filePath = join(DATA_DIR, `D1_${seasonToFilenameSuffix(season)}.csv`);
  writeFileSync(filePath, `${header}\n${csvBody}\n`);

  return rows.length;
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
}

export async function refreshSeasonData(season: string): Promise<RefreshSummary> {
  const [resultsCount, xgCount] = await Promise.all([refreshCsvResults(season), refreshXgResults(season)]);
  return { season, resultsCount, xgCount };
}
