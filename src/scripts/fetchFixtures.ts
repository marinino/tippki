import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { OPENLIGADB_TO_OUR_NAME } from "../data/openligaTeamNames";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface OpenLigaTeam {
  teamName: string;
  teamIconUrl: string;
}

interface OpenLigaMatch {
  matchDateTime: string;
  team1: OpenLigaTeam;
  team2: OpenLigaTeam;
  group: { groupOrderID: number; groupName: string };
}

async function main() {
  const season = process.argv[2] ?? "2026";
  const res = await fetch(`https://api.openligadb.de/getmatchdata/bl1/${season}`);
  if (!res.ok) throw new Error(`OpenLigaDB-Abruf fehlgeschlagen: ${res.status}`);
  const matches: OpenLigaMatch[] = await res.json();

  const unmapped = new Set<string>();
  const logosByTeam: Record<string, string> = {};

  const fixtures = matches
    .map((m) => {
      const homeTeam = OPENLIGADB_TO_OUR_NAME[m.team1.teamName];
      const awayTeam = OPENLIGADB_TO_OUR_NAME[m.team2.teamName];
      if (!homeTeam) unmapped.add(m.team1.teamName);
      if (!awayTeam) unmapped.add(m.team2.teamName);

      if (homeTeam && m.team1.teamIconUrl) logosByTeam[homeTeam] = m.team1.teamIconUrl;
      if (awayTeam && m.team2.teamIconUrl) logosByTeam[awayTeam] = m.team2.teamIconUrl;

      return {
        homeTeam: homeTeam ?? m.team1.teamName,
        awayTeam: awayTeam ?? m.team2.teamName,
        date: m.matchDateTime,
        matchday: m.group.groupOrderID,
      };
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  if (unmapped.size > 0) {
    console.warn("WARNUNG: Teams ohne Namens-Mapping:", [...unmapped]);
  }

  const fixturesPath = join(__dirname, "..", "..", "data", "fixtures.json");
  writeFileSync(fixturesPath, JSON.stringify(fixtures, null, 2));
  console.log(`${fixtures.length} Spiele der Saison ${season}/${Number(season) + 1} -> ${fixturesPath}`);

  const logosPath = join(__dirname, "..", "..", "data", "teamLogos.json");
  writeFileSync(logosPath, JSON.stringify(logosByTeam, null, 2));
  console.log(`${Object.keys(logosByTeam).length} Team-Logos -> ${logosPath}`);
}

main();
