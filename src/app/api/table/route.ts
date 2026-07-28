import { readFileSync } from "fs";
import { join } from "path";
import { deriveSeasonFromDate } from "../../../data/loadMatches";
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

export async function GET() {
  const season = deriveSeasonFromDate(new Date());

  const logosPath = join(process.cwd(), "data", "teamLogos.json");
  const logosByTeam: Record<string, string> = JSON.parse(readFileSync(logosPath, "utf-8"));

  const res = await fetch(`https://api.openligadb.de/getbltable/bl1/${season}`);
  if (!res.ok) {
    return Response.json({ error: `OpenLigaDB-Abruf fehlgeschlagen: ${res.status}` }, { status: 502 });
  }
  const entries: OpenLigaTableEntry[] = await res.json();

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
    };
  });

  return Response.json({ season, table });
}
