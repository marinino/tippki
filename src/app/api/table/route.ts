import { readFileSync } from "fs";
import { join } from "path";
import { deriveSeasonFromDate, loadAllMatches, parseMatchDate } from "../../../data/loadMatches";
import { OPENLIGADB_TO_OUR_NAME } from "../../../data/openligaTeamNames";

interface OpenLigaTableEntry {
  teamName: string;
  teamIconUrl: string;
  points: number;
  opponentGoals: number;
  goals: number;
  matches: number;
  won: number;
  lost: number;
  draw: number;
  goalDiff: number;
}

export type FormResult = "S" | "U" | "N";

const FORM_LENGTH = 5;

// Die letzten fuenf Ergebnisse je Team, chronologisch (aeltestes links).
//
// computeXgForm liefert nur einen Skalar und taugt dafuer nicht -- die Serie muss aus
// den Spielen selbst kommen. Quelle sind die lokalen CSV-Daten, nicht OpenLigaDB:
// deren Tabellenendpunkt kennt keine Einzelspiele. Beide Seiten benutzen unsere
// internen Teamnamen, OpenLigaDB wird ueber OPENLIGADB_TO_OUR_NAME abgebildet.
function formByTeam(season: string): Record<string, FormResult[]> {
  const matches = loadAllMatches()
    .filter((m) => m.season === season)
    .sort((a, b) => parseMatchDate(a.date).getTime() - parseMatchDate(b.date).getTime());

  const form: Record<string, FormResult[]> = {};
  const push = (team: string, result: FormResult) => {
    (form[team] ??= []).push(result);
  };

  for (const m of matches) {
    if (m.homeGoals > m.awayGoals) {
      push(m.homeTeam, "S");
      push(m.awayTeam, "N");
    } else if (m.homeGoals < m.awayGoals) {
      push(m.homeTeam, "N");
      push(m.awayTeam, "S");
    } else {
      push(m.homeTeam, "U");
      push(m.awayTeam, "U");
    }
  }

  for (const team of Object.keys(form)) {
    form[team] = form[team].slice(-FORM_LENGTH);
  }
  return form;
}

export async function GET() {
  const season = deriveSeasonFromDate(new Date());

  const logosPath = join(process.cwd(), "data", "teamLogos.json");
  const logosByTeam: Record<string, string> = JSON.parse(readFileSync(logosPath, "utf-8"));

  const res = await fetch(`https://api.openligadb.de/getbltable/bl1/${season}`);
  if (!res.ok) {
    return Response.json({ error: `OpenLigaDB-Abruf fehlgeschlagen: ${res.status}` }, { status: 502 });
  }
  const entries: OpenLigaTableEntry[] = await res.json();

  const form = formByTeam(season);

  const table = entries.map((e, i) => {
    const team = OPENLIGADB_TO_OUR_NAME[e.teamName] ?? e.teamName;
    return {
      position: i + 1,
      team,
      logo: logosByTeam[team] ?? e.teamIconUrl ?? null,
      matches: e.matches,
      won: e.won,
      draw: e.draw,
      lost: e.lost,
      goals: e.goals,
      opponentGoals: e.opponentGoals,
      goalDiff: e.goalDiff,
      points: e.points,
      form: form[team] ?? [],
    };
  });

  return Response.json({ season, table });
}
