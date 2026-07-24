import { parse } from "csv-parse/sync";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface Match {
  date: string;
  season: string;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
}

const DATA_DIR = join(__dirname, "..", "..", "data");

function parseCsvFile(filePath: string, season: string): Match[] {
  const raw = readFileSync(filePath, "utf-8");
  const rows: Record<string, string>[] = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
  });

  return rows
    .filter((row) => row.HomeTeam && row.AwayTeam && row.FTHG !== "" && row.FTAG !== "")
    .map((row) => ({
      date: row.Date,
      season,
      homeTeam: row.HomeTeam,
      awayTeam: row.AwayTeam,
      homeGoals: Number(row.FTHG),
      awayGoals: Number(row.FTAG),
    }));
}

export function loadAllMatches(): Match[] {
  const files = readdirSync(DATA_DIR).filter((f) => f.startsWith("D1_") && f.endsWith(".csv"));
  const matches: Match[] = [];

  for (const file of files) {
    const season = file.replace("D1_", "").replace(".csv", "");
    matches.push(...parseCsvFile(join(DATA_DIR, file), season));
  }

  return matches;
}
