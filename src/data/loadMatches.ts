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

// football-data.co.uk-Dateinamen wie "2021" oder "9394" sind zwei zweistellige
// Jahres-Suffixe hintereinander. Als reiner String sortiert "9394" faelschlich NACH
// "2021" (weil '9' > '2'). Wir normalisieren auf das vierstellige Startjahr der
// Saison (z.B. "1993", "2020"), das sortiert sowohl chronologisch als auch als String korrekt.
function normalizeSeasonCode(rawCode: string): string {
  const startSuffix = Number(rawCode.slice(0, 2));
  const startYear = startSuffix >= 50 ? 1900 + startSuffix : 2000 + startSuffix;
  return String(startYear);
}

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
    const season = normalizeSeasonCode(file.replace("D1_", "").replace(".csv", ""));
    matches.push(...parseCsvFile(join(DATA_DIR, file), season));
  }

  return matches;
}
