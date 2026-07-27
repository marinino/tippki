import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// OpenLigaDB-Teamname -> unsere (football-data.co.uk-) Namenskonvention.
const OPENLIGADB_TO_OUR_NAME: Record<string, string> = {
  "1. FC Köln": "FC Koln",
  "1. FC Union Berlin": "Union Berlin",
  "1. FSV Mainz 05": "Mainz",
  "Bayer 04 Leverkusen": "Leverkusen",
  "Borussia Dortmund": "Dortmund",
  "Borussia Mönchengladbach": "M'gladbach",
  "Eintracht Frankfurt": "Ein Frankfurt",
  "FC Augsburg": "Augsburg",
  "FC Bayern München": "Bayern Munich",
  "FC Schalke 04": "Schalke 04",
  "Hamburger SV": "Hamburg",
  "RB Leipzig": "RB Leipzig",
  "SC Freiburg": "Freiburg",
  "SC Paderborn 07": "Paderborn",
  "SV 07 Elversberg": "Elversberg",
  "SV Werder Bremen": "Werder Bremen",
  "TSG Hoffenheim": "Hoffenheim",
  "VfB Stuttgart": "Stuttgart",
};

interface OpenLigaMatch {
  matchDateTime: string;
  team1: { teamName: string };
  team2: { teamName: string };
  group: { groupOrderID: number; groupName: string };
}

async function main() {
  const season = process.argv[2] ?? "2026";
  const res = await fetch(`https://api.openligadb.de/getmatchdata/bl1/${season}`);
  if (!res.ok) throw new Error(`OpenLigaDB-Abruf fehlgeschlagen: ${res.status}`);
  const matches: OpenLigaMatch[] = await res.json();

  const unmapped = new Set<string>();
  const fixtures = matches
    .map((m) => {
      const homeTeam = OPENLIGADB_TO_OUR_NAME[m.team1.teamName];
      const awayTeam = OPENLIGADB_TO_OUR_NAME[m.team2.teamName];
      if (!homeTeam) unmapped.add(m.team1.teamName);
      if (!awayTeam) unmapped.add(m.team2.teamName);
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

  const outPath = join(__dirname, "..", "..", "data", "fixtures.json");
  writeFileSync(outPath, JSON.stringify(fixtures, null, 2));
  console.log(`${fixtures.length} Spiele der Saison ${season}/${Number(season) + 1} -> ${outPath}`);
}

main();
