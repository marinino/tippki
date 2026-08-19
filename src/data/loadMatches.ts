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
  // Bisher ungenutzte Spielstatistik, verfuegbar in allen Saisons.
  shotsOnTargetHome?: number;
  shotsOnTargetAway?: number;

  // ---------------------------------------------------------------------------
  // Ab hier ausschliesslich MASSSTAB. Kein Feld unterhalb dieser Linie darf jemals
  // in src/model/ gelesen werden -- sonst schreibt das Modell den Gegner ab, gegen
  // den es antreten soll. Die Auswertung liegt in src/eval/benchmarkOdds.ts.
  // ---------------------------------------------------------------------------

  // Pinnacle-Schlussquote. In allen Saisons vorhanden und die schaerfste verfuegbare
  // Referenz -- die Standardmesslatte des Projekts.
  closeOddsHome?: number;
  closeOddsDraw?: number;
  closeOddsAway?: number;
  closeOddsOver25?: number;
  closeOddsUnder25?: number;
  closeAhLine?: number;
  closeAhOddsHome?: number;
  closeAhOddsAway?: number;

  // Marktmittel zum Anpfiff. Erst ab Saison 2019 in den Dateien.
  avgCloseOddsHome?: number;
  avgCloseOddsDraw?: number;
  avgCloseOddsAway?: number;
  avgCloseOddsOver25?: number;
  avgCloseOddsUnder25?: number;
  avgCloseAhLine?: number;
  avgCloseAhOddsHome?: number;
  avgCloseAhOddsAway?: number;

  // Marktmittel zur Eroeffnung. Der weichste der drei Gegner, dafuer in allen Saisons.
  openOddsHome?: number;
  openOddsDraw?: number;
  openOddsAway?: number;
  openOddsOver25?: number;
  openOddsUnder25?: number;
  openAhLine?: number;
  openAhOddsHome?: number;
  openAhOddsAway?: number;
}

// Die CSVs kommen in zwei Spaltenschemata: Saisons bis 2018/19 nutzen die
// Betbrain-Aggregate (BbAv>2.5, BbAHh, ...), ab 2019/20 die modernen Namen (Avg>2.5, AHh,
// ...). Deshalb Aufloesung ueber eine Namenskette statt ueber feste Spaltennamen.
function pickColumn(row: Record<string, string>, names: readonly string[]): number | undefined {
  for (const name of names) {
    const raw = row[name];
    if (raw === undefined || raw === "") continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

// "C" im Spaltennamen steht bei football-data.co.uk fuer closing. PS = Pinnacle Sports,
// P = dasselbe Haus unter neuem Namen, Avg = Mittel ueber alle erfassten Buchmacher.
const COLUMNS = {
  closeHome: ["PSCH"],
  closeDraw: ["PSCD"],
  closeAway: ["PSCA"],
  closeOver25: ["PC>2.5"],
  closeUnder25: ["PC<2.5"],
  closeAhLine: ["AHCh"],
  closeAhHome: ["PCAHH"],
  closeAhAway: ["PCAHA"],

  avgCloseHome: ["AvgCH"],
  avgCloseDraw: ["AvgCD"],
  avgCloseAway: ["AvgCA"],
  avgCloseOver25: ["AvgC>2.5"],
  avgCloseUnder25: ["AvgC<2.5"],
  avgCloseAhLine: ["AHCh"],
  avgCloseAhHome: ["AvgCAHH"],
  avgCloseAhAway: ["AvgCAHA"],

  openHome: ["AvgH", "BbAvH"],
  openDraw: ["AvgD", "BbAvD"],
  openAway: ["AvgA", "BbAvA"],
  openOver25: ["Avg>2.5", "BbAv>2.5"],
  openUnder25: ["Avg<2.5", "BbAv<2.5"],
  openAhLine: ["AHh", "BbAHh"],
  openAhHome: ["AvgAHH", "BbAvAHH"],
  openAhAway: ["AvgAHA", "BbAvAHA"],
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
// Die Gegenrichtung: Saison-Code "2026" -> Dateiname-Suffix "2627". Beide Refresher
// brauchen sie, deshalb steht sie hier bei den uebrigen Saison-Helfern und nicht in einem
// der beiden -- sonst importieren sie sich gegenseitig.
export function seasonToFilenameSuffix(season: string): string {
  const startYear = Number(season);
  return String(startYear % 100).padStart(2, "0") + String((startYear + 1) % 100).padStart(2, "0");
}

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
      shotsOnTargetHome: pickColumn(row, ["HST"]),
      shotsOnTargetAway: pickColumn(row, ["AST"]),

      closeOddsHome: pickColumn(row, COLUMNS.closeHome),
      closeOddsDraw: pickColumn(row, COLUMNS.closeDraw),
      closeOddsAway: pickColumn(row, COLUMNS.closeAway),
      closeOddsOver25: pickColumn(row, COLUMNS.closeOver25),
      closeOddsUnder25: pickColumn(row, COLUMNS.closeUnder25),
      closeAhLine: pickColumn(row, COLUMNS.closeAhLine),
      closeAhOddsHome: pickColumn(row, COLUMNS.closeAhHome),
      closeAhOddsAway: pickColumn(row, COLUMNS.closeAhAway),

      avgCloseOddsHome: pickColumn(row, COLUMNS.avgCloseHome),
      avgCloseOddsDraw: pickColumn(row, COLUMNS.avgCloseDraw),
      avgCloseOddsAway: pickColumn(row, COLUMNS.avgCloseAway),
      avgCloseOddsOver25: pickColumn(row, COLUMNS.avgCloseOver25),
      avgCloseOddsUnder25: pickColumn(row, COLUMNS.avgCloseUnder25),
      avgCloseAhLine: pickColumn(row, COLUMNS.avgCloseAhLine),
      avgCloseAhOddsHome: pickColumn(row, COLUMNS.avgCloseAhHome),
      avgCloseAhOddsAway: pickColumn(row, COLUMNS.avgCloseAhAway),

      openOddsHome: pickColumn(row, COLUMNS.openHome),
      openOddsDraw: pickColumn(row, COLUMNS.openDraw),
      openOddsAway: pickColumn(row, COLUMNS.openAway),
      openOddsOver25: pickColumn(row, COLUMNS.openOver25),
      openOddsUnder25: pickColumn(row, COLUMNS.openUnder25),
      openAhLine: pickColumn(row, COLUMNS.openAhLine),
      openAhOddsHome: pickColumn(row, COLUMNS.openAhHome),
      openAhOddsAway: pickColumn(row, COLUMNS.openAhAway),
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
