// Welche Dateien die Automatik pflegt -- und was sie bedeuten.
//
// Die Liste ist ausdruecklich und nicht "alles unter data/": ein Verzeichnislisting wuerde
// jede Datei ausliefern, die dort irgendwann einmal landet, und der Download-Endpunkt
// haengt hinter dem Admin-Login, nicht hinter nichts.

import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";

export interface DataFile {
  name: string;
  beschreibung: string;
  // Wird die Datei von der Automatik geschrieben, oder ist sie Bestand?
  gepflegt: boolean;
}

export const DATA_FILES: readonly DataFile[] = [
  {
    name: "fixtures.json",
    beschreibung: "Spielplan mit Anstosszeiten. Steuert das Recherchefenster.",
    gepflegt: true,
  },
  {
    name: "teamLogos.json",
    beschreibung: "Wappen je Verein. Von Hand gesetzte Eintraege bleiben stehen.",
    gepflegt: true,
  },
  {
    name: "D1_2627.csv",
    beschreibung: "Laufende Saison: Ergebnisse und Buchmacher-Schlussquoten.",
    gepflegt: true,
  },
  {
    name: "xg_bundesliga.json",
    beschreibung: "xG je Partie (Understat), alle Saisons.",
    gepflegt: true,
  },
  {
    name: "llm_context_cache.json",
    beschreibung: "Recherchierter Spielkontext des zuletzt bearbeiteten Spieltags.",
    gepflegt: true,
  },
  {
    name: "forward_log.jsonl",
    beschreibung: "Vorwaerts-Log: die Vorhersagen vor Anpfiff. Append-only.",
    gepflegt: true,
  },
];

// Die historischen Saisons kommen dazu, wenn jemand alles herunterlaedt -- angezeigt
// werden sie einzeln nicht, sie aendern sich nie.
export const ARCHIVE_PATTERN = /^D1_\d{4}\.csv$/;

export interface DataFileStatus extends DataFile {
  vorhanden: boolean;
  groesse: number | null;
  geaendert: string | null;
}

export function dataFileStatus(): DataFileStatus[] {
  return DATA_FILES.map((f) => {
    const path = join(process.cwd(), "data", f.name);
    if (!existsSync(path)) {
      return { ...f, vorhanden: false, groesse: null, geaendert: null };
    }
    const stat = statSync(path);
    return {
      ...f,
      vorhanden: true,
      groesse: stat.size,
      geaendert: stat.mtime.toISOString(),
    };
  });
}

// Kein Pfad aus dem Request landet je im Dateisystem: der Name muss aus der Liste oben
// stammen oder dem Archivmuster entsprechen. Damit ist "../../.env" kein Dateiname,
// sondern ein unbekannter Eintrag.
export function isKnownDataFile(name: string): boolean {
  return DATA_FILES.some((f) => f.name === name) || ARCHIVE_PATTERN.test(name);
}

export function readDataFile(name: string): Buffer | null {
  if (!isKnownDataFile(name)) return null;
  const path = join(process.cwd(), "data", name);
  return existsSync(path) ? readFileSync(path) : null;
}

export function contentTypeOf(name: string): string {
  if (name.endsWith(".json")) return "application/json; charset=utf-8";
  if (name.endsWith(".jsonl")) return "application/x-ndjson; charset=utf-8";
  if (name.endsWith(".csv")) return "text/csv; charset=utf-8";
  return "application/octet-stream";
}
