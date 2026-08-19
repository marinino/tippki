// Buchmacher-Schlussquoten der LAUFENDEN Saison nachladen -- ausschliesslich als MASSSTAB.
//
// Warum das noetig ist: die Ergebnisse der laufenden Saison kommen aus OpenLigaDB, weil die
// dort binnen einer Stunde nach Abpfiff stehen. OpenLigaDB kennt aber keine Quoten. Die
// Saisondatei der laufenden Saison hatte deshalb genau sieben Spalten, und
// `benchmarkQuote()` lieferte fuer jedes Spiel dieser Saison null -- der Vergleich mit dem
// Buchmacher war ausgerechnet fuer die Spiele unmoeglich, um die es geht. Alle zwoelf
// historischen Saisons haben ihn, die laufende nicht.
//
// football-data.co.uk veroeffentlicht dieselbe Datei, aus der auch die historischen Saisons
// stammen, waehrend der Saison fortlaufend -- inklusive Schlussquoten. Sie kommt mit ein bis
// drei Tagen Verzug. Fuer diesen Zweck ist das egal: verglichen wird ohnehin erst nach dem
// Spiel, und die Schlussquote IST die Linie zum Anpfiff. Genau die soll es sein -- die
// bestinformierte Version des Gegners, nicht die leichteste.
//
// Die Quoten landen in derselben Saisondatei wie die Ergebnisse, im selben Schema wie
// ueberall sonst. Kein Sonderweg und keine zweite Datei -- damit funktioniert die gesamte
// bestehende Auswertung auf der laufenden Saison unveraendert. Dass das Modell sie trotzdem
// nie zu sehen bekommt, sichert der Importtest in selfCheck.ts, nicht diese Datei.

import { parse } from "csv-parse/sync";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { seasonToFilenameSuffix } from "./loadMatches";

const DATA_DIR = join(process.cwd(), "data");

function sourceUrl(season: string): string {
  return `https://www.football-data.co.uk/mmz4281/${seasonToFilenameSuffix(season)}/D1.csv`;
}

export interface MarketRefreshSummary {
  season: string;
  // false = football-data fuehrt die Saison noch nicht. Vor dem ersten Spieltag der
  // Normalzustand und kein Fehler.
  published: boolean;
  fetchedRows: number;
  updatedRows: number;
  addedRows: number;
  // Wie viele Zeilen der Saisondatei am Ende eine verwertbare Messlatte tragen. Getrennt
  // ausgewiesen, weil Pinnacle in den Dateien loechrig geworden ist (149 von 306 Spielen in
  // 2025/26) -- wer das nicht sieht, wundert sich spaeter ueber die halbe Fallzahl.
  withPinnacleClose: number;
  withAverageClose: number;
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// Innerhalb einer Saison kommt jede Paarung genau einmal vor -- Heim- und Auswaertsspiel
// unterscheiden sich in der Reihenfolge. Bewusst NICHT ueber das Datum: OpenLigaDB und
// football-data melden verlegte Partien nicht immer taggleich, und ein Schluessel, der an
// einer Verlegung bricht, wuerde die Zeile stillschweigend verdoppeln.
function matchKey(row: Record<string, string>): string {
  return `${(row.HomeTeam ?? "").trim()}|${(row.AwayTeam ?? "").trim()}`;
}

function countNonEmpty(rows: Record<string, string>[], column: string): number {
  return rows.filter((r) => (r[column] ?? "") !== "").length;
}

export interface MarketMergeResult {
  updatedRows: number;
  addedRows: number;
  rows: Record<string, string>[];
}

// Getrennt von der Netzwerkseite, damit sie pruefbar ist: diese Funktion schreibt die
// Saisondatei neu, und das ist der einzige gefaehrliche Schritt am ganzen Abruf.
export function mergeMarketRows(
  filePath: string,
  fetched: Record<string, string>[]
): MarketMergeResult {
  const existing: Record<string, string>[] = existsSync(filePath)
    ? parse(readFileSync(filePath, "utf-8"), { columns: true, skip_empty_lines: true, bom: true })
    : [];

  // Spaltenreihenfolge von football-data, danach alles, was nur lokal existiert. Damit sieht
  // die laufende Saison am Ende aus wie jede historische.
  const header = Object.keys(fetched[0]).filter((c) => c !== "");
  for (const row of existing) {
    for (const column of Object.keys(row)) {
      if (column !== "" && !header.includes(column)) header.push(column);
    }
  }

  const existingByKey = new Map(existing.map((r) => [matchKey(r), r]));
  const rows: Record<string, string>[] = [];
  let updatedRows = 0;
  let addedRows = 0;

  for (const row of fetched) {
    const key = matchKey(row);
    const local = existingByKey.get(key);
    if (local) updatedRows++;
    else addedRows++;
    existingByKey.delete(key);
    // football-data gewinnt Feld fuer Feld, aber nur wo es etwas zu sagen hat: leere Felder
    // der Fremddatei duerfen keine lokal vorhandenen Werte loeschen.
    const target: Record<string, string> = { ...(local ?? {}) };
    for (const column of header) {
      const value = row[column];
      if (value !== undefined && value !== "") target[column] = value;
    }
    rows.push(target);
  }

  // Spiele, die football-data noch nicht fuehrt (typischerweise der juengste Spieltag),
  // bleiben unveraendert stehen -- sonst waere die Datei nach dem Abruf aelter als vorher.
  for (const leftover of existingByKey.values()) rows.push(leftover);

  const body = rows
    .map((row) => header.map((column) => csvEscape(row[column] ?? "")).join(","))
    .join("\n");
  writeFileSync(filePath, `${header.join(",")}\n${body}\n`);

  return { updatedRows, addedRows, rows };
}

export async function refreshMarketOdds(season: string): Promise<MarketRefreshSummary> {
  const empty: MarketRefreshSummary = {
    season,
    published: false,
    fetchedRows: 0,
    updatedRows: 0,
    addedRows: 0,
    withPinnacleClose: 0,
    withAverageClose: 0,
  };

  const res = await fetch(sourceUrl(season));
  if (!res.ok) return empty;

  const text = await res.text();
  const fetched: Record<string, string>[] = parse(text, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    // football-data haengt in manchen Saisons eine leere Spalte an das Zeilenende. Daran
    // scheitern statt sie zu ignorieren waere die falsche Reaktion auf eine Fremddatei.
    relax_column_count: true,
  });

  const usable = fetched.filter((r) => r.HomeTeam && r.AwayTeam);
  if (usable.length === 0) return empty;

  const filePath = join(DATA_DIR, `D1_${seasonToFilenameSuffix(season)}.csv`);
  const merged = mergeMarketRows(filePath, usable);

  return {
    season,
    published: true,
    fetchedRows: usable.length,
    updatedRows: merged.updatedRows,
    addedRows: merged.addedRows,
    withPinnacleClose: countNonEmpty(merged.rows, "PSCH"),
    withAverageClose: countNonEmpty(merged.rows, "AvgCH"),
  };
}
