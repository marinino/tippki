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
  // Bet365-Quoten (1X2) vor Spielbeginn, falls in den football-data.co.uk-Daten vorhanden.
  oddsHome?: number;
  oddsDraw?: number;
  oddsAway?: number;
  // Over/Under 2.5 Tore. Die einzige Totals-Linie in den historischen Daten -- live
  // liefert odds-api.io eine ganze Leiter (siehe scripts/inspectOddsMarkets.ts).
  oddsOver25?: number;
  oddsUnder25?: number;
  // Asian Handicap: Linie aus Heimsicht (negativ = Heim gibt Tore vor) plus beide Quoten.
  ahLine?: number;
  ahOddsHome?: number;
  ahOddsAway?: number;
  // Bisher ungenutzte Spielstatistik, verfuegbar in allen Saisons.
  shotsOnTargetHome?: number;
  shotsOnTargetAway?: number;
}

// Die CSVs kommen in zwei Spaltenschemata: Saisons bis 2018/19 nutzen die
// Betbrain-Aggregate (BbAv>2.5, BbAHh, ...), ab 2019/20 die modernen Namen (Avg>2.5, AHh,
// ...). Deshalb Aufloesung ueber eine Namenskette statt ueber feste Spaltennamen.
// Marktmittel (Avg/BbAv) vor Einzelbuchmacher -- dieselbe Begruendung wie bei
// averageMarketProbabilities in marketOdds.ts.
function pickColumn(row: Record<string, string>, names: readonly string[]): number | undefined {
  for (const name of names) {
    const raw = row[name];
    if (raw === undefined || raw === "") continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

const COLUMNS = {
  over25: ["Avg>2.5", "B365>2.5", "BbAv>2.5", "BbMx>2.5"],
  under25: ["Avg<2.5", "B365<2.5", "BbAv<2.5", "BbMx<2.5"],
  ahLine: ["AHh", "BbAHh"],
  ahHome: ["AvgAHH", "B365AHH", "BbAvAHH"],
  ahAway: ["AvgAHA", "B365AHA", "BbAvAHA"],
} as const;

const DATA_DIR = join(__dirname, "..", "..", "data");

// football-data.co.uk-Datumsformat ist tt/mm/jjjj (oder tt/mm/jj bei alten Dateien).
export function parseMatchDate(date: string): Date {
  const [day, month, yearRaw] = date.split("/").map(Number);
  const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
  return new Date(year, month - 1, day);
}

// Bundesliga-Saisons laufen von August bis Mai. Ein Datum vor Juli gehoert noch zur
// Saison, die im Vorjahr gestartet ist (unsere Saison-Codes sind das Startjahr, z.B. "2020").
export function deriveSeasonFromDate(date: Date): string {
  const month = date.getMonth();
  const year = date.getFullYear();
  return String(month >= 6 ? year : year - 1);
}

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
      oddsHome: row.B365H ? Number(row.B365H) : undefined,
      oddsDraw: row.B365D ? Number(row.B365D) : undefined,
      oddsAway: row.B365A ? Number(row.B365A) : undefined,
      oddsOver25: pickColumn(row, COLUMNS.over25),
      oddsUnder25: pickColumn(row, COLUMNS.under25),
      ahLine: pickColumn(row, COLUMNS.ahLine),
      ahOddsHome: pickColumn(row, COLUMNS.ahHome),
      ahOddsAway: pickColumn(row, COLUMNS.ahAway),
      shotsOnTargetHome: pickColumn(row, ["HST"]),
      shotsOnTargetAway: pickColumn(row, ["AST"]),
    }));
}

function parseAllMatches(): Match[] {
  const files = readdirSync(DATA_DIR).filter((f) => f.startsWith("D1_") && f.endsWith(".csv"));
  const matches: Match[] = [];

  for (const file of files) {
    const season = normalizeSeasonCode(file.replace("D1_", "").replace(".csv", ""));
    matches.push(...parseCsvFile(join(DATA_DIR, file), season));
  }

  return matches;
}

let cachedMatches: Match[] | null = null;

// Ohne Cache wurden bei jedem Request alle 13 CSVs neu gelesen und geparst -- und jede
// API-Route ruft das mindestens einmal auf. Der zurueckgegebene Array wird nirgends
// in-place veraendert (alle Aufrufer filtern/mappen), deshalb ist das Teilen sicher.
export function loadAllMatches(): Match[] {
  if (!cachedMatches) cachedMatches = parseAllMatches();
  return cachedMatches;
}

// Muss nach einem Datenupdate aufgerufen werden (siehe refreshResults.ts), sonst laufen
// die alten Spiele weiter durch den Prozess.
export function clearMatchCache(): void {
  cachedMatches = null;
}
