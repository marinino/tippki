// Per-Spiel-xG, adressiert ueber unsere eigenen Teamnamen.
//
// xgForm.ts haelt xG bereits als Zeitreihe je Team fuer die Formkurve. Fuer den Fit auf
// xG braucht es etwas anderes: den xG-Wert eines KONKRETEN Spiels, nachgeschlagen ueber
// (Heimteam, Auswaertsteam, Datum) in unserer Namenswelt.
//
// Zwei Namenssysteme muessen dafuer zusammenkommen -- football-data.co.uk in den CSVs,
// Understat in der xG-Datei -- und die Bruecke ist OUR_NAME_TO_UNDERSTAT. Der Abgleich
// laeuft ueber den Kalendertag, nicht die Uhrzeit: die CSVs kennen nur das Datum, und
// Understat-Anstosszeiten sind ohnehin lokal.

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { OUR_NAME_TO_UNDERSTAT } from "../data/understatTeamNames";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface XgMatch {
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeXG: number;
  awayXG: number;
}

export interface MatchXg {
  homeXG: number;
  awayXG: number;
}

let index: Map<string, MatchXg> | null = null;

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function buildIndex(): Map<string, MatchXg> {
  const raw = readFileSync(join(__dirname, "..", "..", "data", "xg_bundesliga.json"), "utf-8");
  const matches: XgMatch[] = JSON.parse(raw);

  const built = new Map<string, MatchXg>();
  for (const m of matches) {
    const day = dayKey(new Date(m.date));
    built.set(`${m.homeTeam}|${m.awayTeam}|${day}`, { homeXG: m.homeXG, awayXG: m.awayXG });
  }
  return built;
}

export function clearXgLookupCache(): void {
  index = null;
}

// null, wenn kein Namensmapping existiert oder das Spiel nicht in den xG-Daten steht.
// Der Aufrufer muss dann auf echte Tore zurueckfallen -- lieber ein gemischter Datensatz
// als ein stillschweigend uebersprungenes Spiel.
export function lookupMatchXg(
  ourHomeTeam: string,
  ourAwayTeam: string,
  matchDate: Date
): MatchXg | null {
  const home = OUR_NAME_TO_UNDERSTAT[ourHomeTeam];
  const away = OUR_NAME_TO_UNDERSTAT[ourAwayTeam];
  if (!home || !away) return null;

  if (!index) index = buildIndex();

  const day = dayKey(matchDate);
  const exact = index.get(`${home}|${away}|${day}`);
  if (exact) return exact;

  // Anstosszeiten koennen sich zwischen den Quellen um Mitternacht herum um einen Tag
  // unterscheiden (Zeitzone, Spaetspiele). Deshalb die beiden Nachbartage mitpruefen,
  // bevor aufgegeben wird.
  for (const offset of [-1, 1]) {
    const shifted = new Date(matchDate);
    shifted.setDate(shifted.getDate() + offset);
    const hit = index.get(`${home}|${away}|${dayKey(shifted)}`);
    if (hit) return hit;
  }

  return null;
}
