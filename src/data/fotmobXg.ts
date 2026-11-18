// FotMob als Rueckfallquelle fuer xG, wenn Understat nicht antwortet.
//
// Anlass: Understat stand ab Anfang November 2026 wochenlang auf einer Wartungsseite, und
// der Ergebnis-Job brach jedes Mal ab -- zu Recht, weil Ergebnisse ohne passendes xG das
// Formfenster in die Vorsaison rutschen lassen (VERBESSERUNGEN.md, Punkt 2). Ergebnis:
// keine neuen Daten, solange Understat weg ist.
//
// Bewusst nur ein Lueckenfueller, kein Quellenwechsel. Gemessen an den 70 Spielen, die
// beide Quellen fuer 2026/27 fuehren (Stand 18.11.2026): Korrelation der xG-Differenz
// 0.94, FotMob (Opta) im Mittel 6% niedriger und mit 9% kleinerer Streuung der Differenz.
// Fuer drei Spiele im Formfenster ist das ein Unterschied von wenigen Prozent im
// Formfaktor -- fuer die ganze Historie (3600 Understat-Spiele) waere es ein
// Quellenbruch mitten in den Daten. Deshalb:
//   - bestehende Understat-Eintraege bleiben unangetastet,
//   - FotMob fuellt nur Spiele auf, die Understat (noch) nicht hat,
//   - jeder FotMob-Eintrag traegt source: "fotmob",
//   - sobald Understat wieder antwortet, ersetzt refreshXgResults die ganze Saison wie
//     bisher, und die FotMob-Eintraege sind von selbst wieder weg.
// Keine Umrechnung auf Understat-Skala: das Modell fittet auf Tore, xG wirkt nur ueber
// den Formfaktor, und ein auf 70 Spielen geschaetzter Skalenfaktor waere ein weiterer
// Parameter, der den configHash nicht bewegt.

import { OUR_NAME_TO_UNDERSTAT } from "./understatTeamNames";

export interface XgMatch {
  season: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
  homeXG: number;
  awayXG: number;
  // Fehlt bei Understat-Eintraegen (dem Normalfall); gesetzt nur fuer Lueckenfueller.
  source?: "fotmob";
}

const FOTMOB_BUNDESLIGA_ID = 54;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
// Pause zwischen den Einzelabrufen. Pro Lauf fehlen typischerweise nur die Spiele eines
// Spieltags, das sind neun Abrufe -- kein Grund, FotMob dafuer zu haemmern.
const REQUEST_GAP_MS = 400;

// Nur die Namen, die FotMob anders schreibt als Understat. Alle anderen muessen 1:1 ein
// bekannter Understat-Name sein (siehe toUnderstatName). Ein Aufsteiger, den FotMob
// anders nennt, laeuft damit laut auf, statt unter falschem Namen still eine eigene,
// leere Formkurve zu bekommen.
export const FOTMOB_TO_UNDERSTAT: Record<string, string> = {
  "Bayern München": "Bayern Munich",
  "Borussia Mönchengladbach": "Borussia M.Gladbach",
  "1. FC Köln": "FC Cologne",
  "RB Leipzig": "RasenBallsport Leipzig",
  "1. FC Heidenheim": "FC Heidenheim",
  "FC St. Pauli": "St. Pauli",
  "1. FC Nürnberg": "Nuernberg",
  "Fortuna Düsseldorf": "Fortuna Duesseldorf",
  "Greuther Fürth": "Greuther Fuerth",
  "SpVgg Greuther Fürth": "Greuther Fuerth",
  "Hertha BSC": "Hertha Berlin",
  "VfL Bochum": "Bochum",
  "VfL Wolfsburg": "Wolfsburg",
  "SV Darmstadt 98": "Darmstadt",
  "Darmstadt 98": "Darmstadt",
  "Arminia Bielefeld": "Arminia Bielefeld",
};

const KNOWN_UNDERSTAT_NAMES = new Set(Object.values(OUR_NAME_TO_UNDERSTAT));

export function toUnderstatName(fotmobName: string): string {
  const mapped = FOTMOB_TO_UNDERSTAT[fotmobName] ?? fotmobName;
  if (!KNOWN_UNDERSTAT_NAMES.has(mapped)) {
    throw new Error(
      `FotMob-Team "${fotmobName}" ist keinem Understat-Namen zugeordnet -- ` +
        `in FOTMOB_TO_UNDERSTAT (src/data/fotmobXg.ts) ergaenzen.`
    );
  }
  return mapped;
}

// "2026-11-08T18:30:00Z" -> "2026-11-08 18:30:00". Understat fuehrt die Anstosszeit in
// UTC im selben Format; gegengeprueft an den 70 gemeinsamen Spielen, die sich alle exakt
// ueber Zeitpunkt und Ergebnis zuordnen liessen.
export function toUnderstatDate(utcIso: string): string {
  return new Date(utcIso).toISOString().slice(0, 19).replace("T", " ");
}

function matchKey(m: Pick<XgMatch, "date" | "homeTeam" | "awayTeam">): string {
  return `${m.date.slice(0, 10)}|${m.homeTeam}|${m.awayTeam}`;
}

// Fuegt Lueckenfueller an, ohne einen bestehenden Eintrag anzufassen. Pure Funktion, damit
// sie ohne Netz pruefbar ist.
export function mergeFallbackXg(existing: XgMatch[], fallback: XgMatch[]): XgMatch[] {
  const have = new Set(existing.map(matchKey));
  const added = fallback.filter((m) => !have.has(matchKey(m)));
  return [...existing, ...added].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

interface FotmobFixture {
  id: string;
  home: { name: string };
  away: { name: string };
  status: { utcTime: string; finished: boolean; cancelled?: boolean; scoreStr?: string };
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`FotMob-Abruf fehlgeschlagen: ${res.status} (${url})`);
  const body = await res.text();
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`FotMob liefert kein JSON (${url})`);
  }
}

function teamXgOf(details: any): [number, number] | null {
  const groups: any[] = details?.content?.stats?.Periods?.All?.stats ?? [];
  for (const group of groups) {
    for (const stat of group?.stats ?? []) {
      if (stat?.key !== "expected_goals") continue;
      const [home, away] = stat.stats ?? [];
      const h = Number(home);
      const a = Number(away);
      // Die Gruppe "Expected goals (xG)" hat eine leere Kopfzeile mit demselben Schluessel
      // und [null, null] -- die ueberspringen, nicht als 0 lesen.
      if (home != null && away != null && Number.isFinite(h) && Number.isFinite(a)) return [h, a];
    }
  }
  return null;
}

// Holt xG fuer alle abgeschlossenen Spiele der Saison, die in `existing` fehlen. Wirft,
// sobald ein Spiel kein xG hat: ein fehlendes Spiel waere genau das Loch im Formfenster,
// gegen das der ganze Abbruch gebaut ist.
export async function fetchFotmobXgGaps(season: string, existing: XgMatch[]): Promise<XgMatch[]> {
  const seasonLabel = `${season}/${Number(season) + 1}`;
  const league = await fetchJson(
    `https://www.fotmob.com/api/data/leagues?id=${FOTMOB_BUNDESLIGA_ID}&season=${encodeURIComponent(seasonLabel)}`
  );
  const fixtures: FotmobFixture[] = league?.fixtures?.allMatches ?? [];
  if (fixtures.length === 0) throw new Error(`FotMob fuehrt keine Spiele fuer ${seasonLabel}`);

  const have = new Set(existing.map(matchKey));
  const result: XgMatch[] = [];

  for (const f of fixtures) {
    if (!f.status.finished || f.status.cancelled) continue;
    const base = {
      season,
      date: toUnderstatDate(f.status.utcTime),
      homeTeam: toUnderstatName(f.home.name),
      awayTeam: toUnderstatName(f.away.name),
    };
    if (have.has(matchKey(base))) continue;

    const [homeGoals, awayGoals] = (f.status.scoreStr ?? "").split("-").map((s) => Number(s.trim()));
    if (!Number.isInteger(homeGoals) || !Number.isInteger(awayGoals)) {
      throw new Error(`FotMob: kein Endstand fuer ${f.home.name} - ${f.away.name} (${f.status.scoreStr})`);
    }

    await new Promise((resolve) => setTimeout(resolve, REQUEST_GAP_MS));
    const details = await fetchJson(`https://www.fotmob.com/api/data/matchDetails?matchId=${f.id}`);
    const xg = teamXgOf(details);
    if (!xg) throw new Error(`FotMob: kein xG fuer ${f.home.name} - ${f.away.name} (${base.date})`);

    result.push({ ...base, homeGoals, awayGoals, homeXG: xg[0], awayXG: xg[1], source: "fotmob" });
  }

  return result;
}
